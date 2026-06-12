/* ============================================================================
 * ModuleHub Studio — ZIP writer / reader (MHB.studio.zip)
 * ----------------------------------------------------------------------------
 * Self-contained IIFE. No DOM, no fetch — accepts / produces Uint8Array so it
 * can be exercised in plain Node.js (require/load the file, then call the
 * exported helpers directly from a test script).
 *
 * Public surface (MHB.studio.zip):
 *   .build(files)           → Uint8Array   — write a STORED-only ZIP
 *     files: [{ name: string, data: Uint8Array|string }]
 *   .parse(bytes)           → { files: { [name]: Uint8Array }, error?: string }
 *     supports: stored (method 0) + deflated (method 8 via DecompressionStream)
 *     rejects : zip64, encryption → returns { files:{}, error: '<msg>' }
 *
 * ZIP format refs: PKWARE APPNOTE.TXT 6.3.x
 * ============================================================================ */
(function (MHB) {
  'use strict';

  /* ── CRC-32 ──────────────────────────────────────────────────────────────── */

  var _crcTable = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      t[n] = c;
    }
    return t;
  }());

  function crc32(bytes) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      crc = _crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /* ── Encode string as UTF-8 bytes ───────────────────────────────────────── */

  function encodeUtf8(str) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(str);
    }
    /* Fallback — ASCII + basic Latin supplement only (safe for file names) */
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        bytes.push(c);
      } else if (c < 0x800) {
        bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      } else {
        bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      }
    }
    return new Uint8Array(bytes);
  }

  /* ── Decode UTF-8 bytes to string ───────────────────────────────────────── */

  function decodeUtf8(bytes) {
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8').decode(bytes);
    }
    var s = '';
    var i = 0;
    while (i < bytes.length) {
      var b = bytes[i++];
      if (b < 0x80) { s += String.fromCharCode(b); }
      else if ((b & 0xE0) === 0xC0) { s += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i++] & 0x3F)); }
      else { s += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F)); }
    }
    return s;
  }

  /* ── Little-endian writers ──────────────────────────────────────────────── */

  function writeU16(view, offset, v) { view.setUint16(offset, v, true); }
  function writeU32(view, offset, v) { view.setUint32(offset, v, true); }

  /* ── Little-endian readers ──────────────────────────────────────────────── */

  function readU16(view, offset) { return view.getUint16(offset, true); }
  function readU32(view, offset) { return view.getUint32(offset, true); }

  /* ── Concat Uint8Arrays ─────────────────────────────────────────────────── */

  function concat(arrays) {
    var total = 0;
    for (var i = 0; i < arrays.length; i++) { total += arrays[i].length; }
    var out = new Uint8Array(total);
    var pos = 0;
    for (var j = 0; j < arrays.length; j++) {
      out.set(arrays[j], pos);
      pos += arrays[j].length;
    }
    return out;
  }

  /* ── DOS date/time (fixed epoch for determinism) ────────────────────────── */
  var DOS_DATE = 0x5380;  // 2021-12-01
  var DOS_TIME = 0x0000;

  /* ── Build a STORED ZIP ─────────────────────────────────────────────────── */
  /*
   * Local file header (30 + nameLen bytes) + data
   * Central directory entry (46 + nameLen bytes) per file
   * End of central directory record (22 bytes)
   */

  function build(files) {
    /* Normalise: convert string data to Uint8Array */
    var entries = files.map(function (f) {
      var data = (typeof f.data === 'string') ? encodeUtf8(f.data) : f.data;
      var nameBytes = encodeUtf8(f.name);
      var crc = crc32(data);
      return { nameBytes: nameBytes, data: data, crc: crc };
    });

    var localParts = [];  /* local header + data chunks per file */
    var offsets    = [];  /* byte offset of each local header */
    var pos        = 0;

    entries.forEach(function (e) {
      offsets.push(pos);
      var nLen = e.nameBytes.length;
      var hdr  = new Uint8Array(30 + nLen);
      var v    = new DataView(hdr.buffer);

      writeU32(v, 0,  0x04034B50);   /* local file header sig */
      writeU16(v, 4,  20);           /* version needed: 2.0 */
      writeU16(v, 6,  0x0800);       /* general flag: UTF-8 name */
      writeU16(v, 8,  0);            /* compression: stored */
      writeU16(v, 10, DOS_TIME);
      writeU16(v, 12, DOS_DATE);
      writeU32(v, 14, e.crc);
      writeU32(v, 18, e.data.length);  /* compressed size */
      writeU32(v, 22, e.data.length);  /* uncompressed size */
      writeU16(v, 26, nLen);
      writeU16(v, 28, 0);              /* extra field length */
      hdr.set(e.nameBytes, 30);

      localParts.push(hdr, e.data);
      pos += hdr.length + e.data.length;
    });

    /* Central directory */
    var cdStart   = pos;
    var cdParts   = [];

    entries.forEach(function (e, i) {
      var nLen = e.nameBytes.length;
      var cd   = new Uint8Array(46 + nLen);
      var v    = new DataView(cd.buffer);

      writeU32(v, 0,  0x02014B50);   /* central dir sig */
      writeU16(v, 4,  0x031E);       /* version made by: Unix / 3.0 */
      writeU16(v, 6,  20);           /* version needed */
      writeU16(v, 8,  0x0800);       /* general flag: UTF-8 */
      writeU16(v, 10, 0);            /* compression: stored */
      writeU16(v, 12, DOS_TIME);
      writeU16(v, 14, DOS_DATE);
      writeU32(v, 16, e.crc);
      writeU32(v, 20, e.data.length);  /* compressed size */
      writeU32(v, 24, e.data.length);  /* uncompressed size */
      writeU16(v, 28, nLen);
      writeU16(v, 30, 0);             /* extra field */
      writeU16(v, 32, 0);             /* file comment */
      writeU16(v, 34, 0);             /* disk start */
      writeU16(v, 36, 0);             /* internal attrs */
      writeU32(v, 38, 0);             /* external attrs */
      writeU32(v, 42, offsets[i]);    /* local header offset */
      cd.set(e.nameBytes, 46);

      cdParts.push(cd);
      pos += cd.length;
    });

    /* End of central directory */
    var cdSize = pos - cdStart;
    var eocd   = new Uint8Array(22);
    var ev     = new DataView(eocd.buffer);

    writeU32(ev, 0,  0x06054B50);    /* EOCD sig */
    writeU16(ev, 4,  0);             /* disk number */
    writeU16(ev, 6,  0);             /* disk w/ CD */
    writeU16(ev, 8,  entries.length);
    writeU16(ev, 10, entries.length);
    writeU32(ev, 12, cdSize);
    writeU32(ev, 16, cdStart);
    writeU16(ev, 20, 0);             /* comment length */

    return concat(localParts.concat(cdParts, [eocd]));
  }

  /* ── Parse a ZIP (stored + deflate) ────────────────────────────────────── */
  /*
   * Strategy: locate EOCD, walk central directory, extract each entry.
   * Reject zip64 (extra-field tag 0x0001 or sizes == 0xFFFFFFFF) and
   * encrypted entries (general-purpose bit 0).
   */

  function parse(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    /* ── Locate EOCD (search back from end) ─────────────────────────────── */
    var eocdOffset = -1;
    for (var i = bytes.length - 22; i >= 0; i--) {
      if (readU32(view, i) === 0x06054B50) { eocdOffset = i; break; }
    }
    if (eocdOffset === -1) { return { files: {}, error: 'Not a valid ZIP: EOCD not found' }; }

    var cdCount  = readU16(view, eocdOffset + 8);
    var cdSize   = readU32(view, eocdOffset + 12);   /* eslint-disable-line no-unused-vars */
    var cdOffset = readU32(view, eocdOffset + 16);

    /* Zip64 guard: if either EOCD field is 0xFFFFFFFF → zip64 */
    if (cdOffset === 0xFFFFFFFF || readU32(view, eocdOffset + 12) === 0xFFFFFFFF) {
      return { files: {}, error: 'ZIP64 archives are not supported. Please re-save as standard ZIP.' };
    }

    var files = {};
    var cdPos = cdOffset;

    for (var e = 0; e < cdCount; e++) {
      if (cdPos + 46 > bytes.length) { break; }
      var sig = readU32(view, cdPos);
      if (sig !== 0x02014B50) { return { files: {}, error: 'Central directory corrupted (bad signature at offset ' + cdPos + ')' }; }

      var generalFlag  = readU16(view, cdPos + 8);
      var method       = readU16(view, cdPos + 10);
      var crc          = readU32(view, cdPos + 16);   /* eslint-disable-line no-unused-vars */
      var compSize     = readU32(view, cdPos + 20);
      var uncompSize   = readU32(view, cdPos + 24);
      var nameLen      = readU16(view, cdPos + 28);
      var extraLen     = readU16(view, cdPos + 30);
      var commentLen   = readU16(view, cdPos + 32);
      var localOffset  = readU32(view, cdPos + 42);

      /* Encryption check (bit 0) */
      if (generalFlag & 0x1) {
        return { files: {}, error: 'Encrypted ZIP entries are not supported.' };
      }
      /* Zip64 extra field tag */
      if (compSize === 0xFFFFFFFF || uncompSize === 0xFFFFFFFF) {
        return { files: {}, error: 'ZIP64 archives are not supported. Please re-save as standard ZIP.' };
      }
      /* Method: only stored (0) and deflated (8) */
      if (method !== 0 && method !== 8) {
        return { files: {}, error: 'Unsupported compression method ' + method + ' (only stored/deflate supported).' };
      }

      var nameBytes = bytes.subarray(cdPos + 46, cdPos + 46 + nameLen);
      var name      = decodeUtf8(nameBytes);

      /* Advance to next CD entry */
      cdPos += 46 + nameLen + extraLen + commentLen;

      /* Skip directories */
      if (name.charAt(name.length - 1) === '/') { continue; }

      /* Read local file header to find data offset */
      if (localOffset + 30 > bytes.length) { continue; }
      var lSig = readU32(view, localOffset);
      if (lSig !== 0x04034B50) { return { files: {}, error: 'Local file header corrupted for "' + name + '"' }; }

      var lNameLen  = readU16(view, localOffset + 26);
      var lExtraLen = readU16(view, localOffset + 28);
      var dataStart = localOffset + 30 + lNameLen + lExtraLen;
      var compData  = bytes.subarray(dataStart, dataStart + compSize);

      if (method === 0) {
        /* Stored */
        files[name] = compData.slice();
      } else {
        /* Deflate — decompress synchronously via DecompressionStream if available */
        /* We store a tagged object; caller checks .pending and awaits .promise */
        files[name] = { _deflate: true, compData: compData.slice(), uncompSize: uncompSize };
      }
    }

    return { files: files };
  }

  /* ── Inflate helper (async, uses DecompressionStream) ───────────────────── */

  function inflateAll(parseResult) {
    /* Resolve all _deflate entries asynchronously, return Promise<result> */
    var files = parseResult.files;
    var names = Object.keys(files);
    var promises = names.map(function (name) {
      var entry = files[name];
      if (!entry || !entry._deflate) { return Promise.resolve(); }
      if (typeof DecompressionStream === 'undefined') {
        return Promise.reject(new Error('DecompressionStream not available; cannot inflate entry "' + name + '"'));
      }
      var ds      = new DecompressionStream('deflate-raw');
      var writer  = ds.writable.getWriter();
      var reader  = ds.readable.getReader();
      var chunks  = [];
      var reading = (function readLoop() {
        return reader.read().then(function (r) {
          if (r.done) { return; }
          chunks.push(r.value);
          return readLoop();
        });
      }());
      writer.write(entry.compData);
      writer.close();
      return reading.then(function () {
        var total = chunks.reduce(function (s, c) { return s + c.length; }, 0);
        var out   = new Uint8Array(total);
        var pos   = 0;
        chunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
        files[name] = out;
      });
    });
    return Promise.all(promises).then(function () { return parseResult; });
  }

  /* ── Export onto MHB.studio.zip ─────────────────────────────────────────── */

  MHB.studio = MHB.studio || {};
  MHB.studio.zip = {
    /** Build a stored-only ZIP from an array of { name, data } entries.
     *  data may be Uint8Array or string. Returns Uint8Array. */
    build: build,

    /** Parse bytes (Uint8Array) synchronously for stored entries.
     *  Deflated entries are resolved when you call inflateAll().
     *  Returns { files, error? } where files is { name: Uint8Array | _deflateObj }. */
    parseSyncPartial: parse,

    /** Parse bytes and return Promise<{ files, error? }> with all entries inflated. */
    parseAsync: function (bytes) {
      var result = parse(bytes);
      if (result.error) { return Promise.resolve(result); }
      return inflateAll(result).catch(function (err) {
        return { files: {}, error: String(err && err.message || err) };
      });
    },

    /** Low-level helpers exposed for testing */
    _crc32: crc32,
    _encodeUtf8: encodeUtf8,
    _decodeUtf8: decodeUtf8,
  };

}(window.MHB));

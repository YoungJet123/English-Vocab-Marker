/* parsers.js — 从文本/文件解析为 {word: definition} 形式的词表 */

/* ---------------- TXT ---------------- */
// 规则：
//   - 空行、以 # 开头视为注释跳过
//   - 单行仅英文字母/连字符 => 纯单词列表，释义为空
//   - 行内若存在 "[音标]"，删除之
//   - 余下部分按首个空白/制表分隔为 word 和 definition
export function parseTXT(text) {
  const out = {};
  const lines = text.replace(/\r/g, '').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // 去掉音标
    const stripped = line.replace(/\s*\[[^\]]+\]\s*/g, ' ').trim();
    // 尝试用 "," "\t" 或空白分词
    let word, def;
    const mTab = stripped.split(/\t/);
    if (mTab.length > 1) {
      word = mTab[0].trim();
      def = mTab.slice(1).join(' ').trim();
    } else {
      const m = stripped.match(/^([A-Za-z][A-Za-z'\- ]*?)(?:\s+(.+))?$/);
      if (!m) continue;
      word = m[1].trim();
      def = (m[2] || '').trim();
    }
    if (!/^[A-Za-z][A-Za-z'\- ]*$/.test(word)) continue;
    out[word.toLowerCase()] = def;
  }
  return out;
}

/* ---------------- CSV ---------------- */
// 最小 CSV：支持双引号包裹、双引号转义（""）。取前两列。
export function parseCSV(text) {
  const out = {};
  const rows = [];
  let cur = [''];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; }
        else inQuotes = false;
      } else {
        cur[cur.length - 1] += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') cur.push('');
      else if (c === '\n' || c === '\r') {
        if (cur.length > 1 || cur[0] !== '') rows.push(cur);
        cur = [''];
        if (c === '\r' && text[i + 1] === '\n') i++;
      } else {
        cur[cur.length - 1] += c;
      }
    }
  }
  if (cur.length > 1 || cur[0] !== '') rows.push(cur);
  // 跳过表头（如第一行第一列为 "word"/"单词"）
  let start = 0;
  if (rows.length > 0) {
    const first = (rows[0][0] || '').trim().toLowerCase();
    if (['word', 'words', '单词', '词汇'].includes(first)) start = 1;
  }
  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    const word = (row[0] || '').trim();
    const def = (row[1] || '').trim();
    if (!/^[A-Za-z][A-Za-z'\- ]*$/.test(word)) continue;
    out[word.toLowerCase()] = def;
  }
  return out;
}

/* ---------------- JSON ---------------- */
// 接受两种格式：{word: def} 或 [{word: "xxx", def/definition/meaning: "yyy"}, ...]
export function parseJSON(text) {
  const out = {};
  const data = JSON.parse(text);
  if (Array.isArray(data)) {
    for (const it of data) {
      if (typeof it === 'string') {
        if (/^[A-Za-z][A-Za-z'\- ]*$/.test(it)) out[it.toLowerCase()] = '';
      } else if (it && typeof it === 'object') {
        const w = it.word || it.Word || it.WORD || it.w;
        if (!w || typeof w !== 'string') continue;
        const d = it.def || it.definition || it.meaning || it.translation || it.cn || '';
        if (!/^[A-Za-z][A-Za-z'\- ]*$/.test(w)) continue;
        out[w.toLowerCase()] = typeof d === 'string' ? d : '';
      }
    }
  } else if (data && typeof data === 'object') {
    for (const w of Object.keys(data)) {
      if (!/^[A-Za-z][A-Za-z'\- ]*$/.test(w)) continue;
      const v = data[w];
      out[w.toLowerCase()] = typeof v === 'string' ? v : (v && v.def) || '';
    }
  }
  return out;
}

/* ---------------- XLSX ----------------
   最小 xlsx 解析：用 fflate 或原生 CompressionStream 不稳，改用手写 ZIP 读取器；
   实际上浏览器不带 zip，因此这里接受 ArrayBuffer 后用 DecompressionStream 解 deflate。
   然后解析 sharedStrings.xml 和 sheet1.xml，取 A/B 列。
-----------------------------------------*/

async function readZipEntries(buf) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  // 搜 End-of-central-directory (EOCD) 签名 0x06054b50
  let eocd = -1;
  for (let i = dv.byteLength - 22; i >= Math.max(0, dv.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx/zip 文件');
  const cdOffset = dv.getUint32(eocd + 16, true);
  const cdCount = dv.getUint16(eocd + 10, true);
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('central dir 损坏');
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const uncompressedSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = new TextDecoder('utf-8').decode(u8.slice(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  // 读取每个 entry 的数据
  async function entryData(e) {
    const lh = e.localOffset;
    if (dv.getUint32(lh, true) !== 0x04034b50) throw new Error('local header 损坏');
    const nameLen = dv.getUint16(lh + 26, true);
    const extraLen = dv.getUint16(lh + 28, true);
    const dataStart = lh + 30 + nameLen + extraLen;
    const raw = u8.slice(dataStart, dataStart + e.compressedSize);
    if (e.method === 0) return raw;
    if (e.method === 8) {
      const ds = new DecompressionStream('deflate-raw');
      const stream = new Response(raw).body.pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error('不支持的压缩方式: ' + e.method);
  }
  return { entries, entryData };
}

export async function parseXLSX(arrayBuffer) {
  const { entries, entryData } = await readZipEntries(arrayBuffer);
  const dec = new TextDecoder('utf-8');
  const findEntry = (name) => entries.find(e => e.name === name);

  const sharedEntry = findEntry('xl/sharedStrings.xml');
  const strings = [];
  if (sharedEntry) {
    const xml = dec.decode(await entryData(sharedEntry));
    // 提取每个 <si>...</si> 中的全部 <t>...</t> 拼接
    const siMatches = xml.match(/<si[\s\S]*?<\/si>/g) || [];
    for (const si of siMatches) {
      const ts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
      let joined = '';
      for (const t of ts) {
        joined += t.replace(/<t[^>]*>/, '').replace(/<\/t>$/, '');
      }
      strings.push(decodeXMLEntities(joined));
    }
  }

  const sheetEntry = findEntry('xl/worksheets/sheet1.xml')
    || entries.find(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name));
  if (!sheetEntry) throw new Error('找不到 worksheet');
  const sheetXml = dec.decode(await entryData(sheetEntry));

  // 按 row 切分
  const rowMatches = sheetXml.match(/<row[\s\S]*?<\/row>/g) || [];
  const rows = [];
  for (const rowXml of rowMatches) {
    // 提取每个 <c r="A1" t="s"><v>0</v></c>
    const cells = { /* colLetter -> text */ };
    const cellRe = /<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let m;
    while ((m = cellRe.exec(rowXml)) !== null) {
      const attrs = m[1];
      const body = m[2] || '';
      const rAttr = /\br\s*=\s*"([A-Z]+)(\d+)"/.exec(attrs);
      const tAttr = /\bt\s*=\s*"([^"]+)"/.exec(attrs);
      if (!rAttr) continue;
      const col = rAttr[1];
      const type = tAttr ? tAttr[1] : 'n';
      let value = '';
      if (type === 'inlineStr') {
        const ts = body.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
        value = ts.map(t => t.replace(/<t[^>]*>/, '').replace(/<\/t>$/, '')).join('');
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        if (v) {
          if (type === 's') {
            const idx = parseInt(v[1], 10);
            value = strings[idx] || '';
          } else if (type === 'str') {
            value = v[1];
          } else {
            value = v[1];
          }
        }
      }
      cells[col] = decodeXMLEntities(value);
    }
    rows.push(cells);
  }

  const out = {};
  // 默认 A=word, B=definition；若首行 A="word" 跳过
  let startIdx = 0;
  if (rows.length > 0) {
    const first = (rows[0].A || '').trim().toLowerCase();
    if (['word', 'words', '单词', '词汇'].includes(first)) startIdx = 1;
  }
  for (let i = startIdx; i < rows.length; i++) {
    const w = (rows[i].A || '').trim();
    const d = (rows[i].B || '').trim();
    if (!/^[A-Za-z][A-Za-z'\- ]*$/.test(w)) continue;
    out[w.toLowerCase()] = d;
  }
  return out;
}

function decodeXMLEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/* ---------------- dispatcher ---------------- */

export async function parseFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) {
    const buf = await file.arrayBuffer();
    return parseXLSX(buf);
  }
  const text = await file.text();
  if (name.endsWith('.json')) return parseJSON(text);
  if (name.endsWith('.csv')) return parseCSV(text);
  if (name.endsWith('.tsv')) return parseCSV(text.replace(/\t/g, ','));
  // 默认 txt
  return parseTXT(text);
}

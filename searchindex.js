/**
 * v0.38（B-70）：检索的 SQLite 派生索引。
 *
 * 铁律：**真源永远是 JSONL**。这个库只是派生索引——可以整个删掉，下次检索会从 JSONL 重放重建；
 * 它坏了、读不了、node:sqlite 不存在，一律退回全量扫，绝不挡检索。
 *
 * 为什么用它：现在每次写入都会让「全量签名」失效、整份 JSONL 重新分词（几千行还行，几万行就慢）。
 * 这里按**文件**记签名，只重算改动过的那几个文件（写一条日记只会动当天那一个文件），
 * 检索直接查倒排表拿候选，不用把整个语料装进内存。
 *
 * 中文分词不靠 FTS5（它的 trigram 只认 3 个字以上），用我们自己的 bigram + 英文词（searchTokensOf），
 * 倒排表里存的就是那些 token——跟 scan 引擎用**同一套 token**，排序结果才能逐条一致。
 */
import fs from "node:fs";
import path from "node:path";

let DatabaseSync = null;
let unavailableReason = "";
try {
  const mod = await import("node:sqlite");
  DatabaseSync = mod.DatabaseSync || null;
  if (!DatabaseSync) unavailableReason = "node:sqlite 没有导出 DatabaseSync";
} catch (err) {
  unavailableReason = err?.message || "node:sqlite 不可用";
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS files (rel TEXT PRIMARY KEY, sig TEXT NOT NULL, n INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS docs (
     key TEXT PRIMARY KEY, rel TEXT NOT NULL, line_no INTEGER NOT NULL, line TEXT NOT NULL,
     layer TEXT, ts INTEGER, len INTEGER NOT NULL, toks TEXT NOT NULL DEFAULT '', hash TEXT,
     supersedes TEXT, until TEXT, voided INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS postings (term TEXT NOT NULL, key TEXT NOT NULL, tf INTEGER NOT NULL, PRIMARY KEY (term, key)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_docs_rel ON docs(rel)`,
];

/** node:sqlite 到底能不能用；不能用时返回原因（调用方据此静默退回 scan）。 */
export function sqliteUnavailableReason() {
  return DatabaseSync ? "" : unavailableReason || "node:sqlite 不可用";
}

export function sqliteAvailable() {
  return !!DatabaseSync;
}

const placeholders = (n) => Array(n).fill("?").join(",");

/**
 * 打开（必要时新建）一个派生索引。
 * @param {{dbPath:string}} opts
 */
export function createSearchIndex({ dbPath }) {
  if (!DatabaseSync) throw new Error(sqliteUnavailableReason());
  const target = path.resolve(String(dbPath));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new DatabaseSync(target);
  // 库文件被写坏/不是 SQLite 时，必须在抛错前把句柄关掉——否则 Windows 上这个文件再也删不掉
  try {
    for (const sql of SCHEMA) db.exec(sql);
    // 派生索引不做迁移：老版本建的表缺新列时直接推平重建（真源在 JSONL，重放就行）
    const cols = db.prepare("PRAGMA table_info(docs)").all().map((r) => String(r.name));
    if (cols.length && !cols.includes("toks")) {
      db.exec("DROP TABLE IF EXISTS postings");
      db.exec("DROP TABLE IF EXISTS docs");
      db.exec("DROP TABLE IF EXISTS files");
      db.exec("DROP TABLE IF EXISTS meta");
      for (const sql of SCHEMA) db.exec(sql);
    }
  } catch (err) {
    try {
      db.close();
    } catch {
      /* 关不掉也要把原错误抛出去 */
    }
    throw err;
  }

  const s = {
    fileSig: db.prepare("SELECT sig FROM files WHERE rel = ?"),
    delFile: db.prepare("DELETE FROM files WHERE rel = ?"),
    insFile: db.prepare("INSERT INTO files (rel, sig, n) VALUES (?, ?, ?)"),
    delDocs: db.prepare("DELETE FROM docs WHERE rel = ?"),
    delPostings: db.prepare("DELETE FROM postings WHERE key IN (SELECT key FROM docs WHERE rel = ?)"),
    insDoc: db.prepare(
      "INSERT OR REPLACE INTO docs (key, rel, line_no, line, layer, ts, len, toks, hash, supersedes, until, voided) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ),
    insPosting: db.prepare("INSERT OR REPLACE INTO postings (term, key, tf) VALUES (?, ?, ?)"),
    allFiles: db.prepare("SELECT rel FROM files"),
    setMeta: db.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)"),
    corpus: db.prepare("SELECT COUNT(*) AS n, COALESCE(AVG(len), 0) AS avgdl FROM docs"),
    termCount: db.prepare("SELECT COUNT(*) AS n FROM postings"),
    df: db.prepare("SELECT COUNT(*) AS n FROM postings WHERE term = ?"),
    supersedes: db.prepare("SELECT hash, supersedes FROM docs WHERE supersedes IS NOT NULL AND supersedes != ''"),
  };

  let inTx = false;
  const tx = (fn) => {
    if (inTx) return fn();
    db.exec("BEGIN");
    inTx = true;
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* 回滚失败也要把原错误抛出去 */
      }
      throw err;
    } finally {
      inTx = false;
    }
  };

  const tfOf = (toks) => {
    const book = new Map();
    for (const t of toks || []) book.set(t, (book.get(t) || 0) + 1);
    return book;
  };

  /**
   * 按文件同步：签名没变的文件整份跳过，只重算改动过的那几个。
   * @param {Array<{rel:string, sig:string, rows:Array<{key:string,lineNo:number,line:string,layer?:string,ts?:number,hash?:string,supersedes?:string,until?:string,voided?:boolean,toks:string[]}>}>} snapshot
   */
  function sync(snapshot) {
    const startedAt = Date.now();
    const rebuilt = [];
    const removed = [];
    let skipped = 0;
    tx(() => {
      const known = new Set(s.allFiles.all().map((r) => r.rel));
      const seen = new Set();
      for (const file of snapshot) {
        seen.add(file.rel);
        const prev = s.fileSig.get(file.rel);
        if (prev && prev.sig === file.sig) {
          skipped += 1;
          continue;
        }
        s.delPostings.run(file.rel);
        s.delDocs.run(file.rel);
        const rows = typeof file.rows === "function" ? file.rows() : file.rows || [];
        for (const row of rows) {
          const toks = Array.isArray(row.toks) ? row.toks : [];
          s.insDoc.run(
            row.key, file.rel, row.lineNo, row.line, row.layer || "", row.ts || 0, toks.length,
            toks.join(" "), row.hash || "", row.supersedes || "", row.until || "", row.voided ? 1 : 0,
          );
          for (const [term, tf] of tfOf(toks)) s.insPosting.run(term, row.key, tf);
        }
        s.delFile.run(file.rel);
        s.insFile.run(file.rel, file.sig, rows.length);
        rebuilt.push(file.rel);
      }
      for (const relPath of known) {
        if (seen.has(relPath)) continue;
        s.delPostings.run(relPath);
        s.delDocs.run(relPath);
        s.delFile.run(relPath);
        removed.push(relPath);
      }
      supersedesCache = null;
      const corpus = s.corpus.get();
      s.setMeta.run("N", String(corpus.n || 0));
      s.setMeta.run("avgdl", String(corpus.avgdl || 0));
      s.setMeta.run("syncedAt", String(Date.now()));
    });
    const corpus = s.corpus.get();
    return { rebuilt, removed, skipped, docs: corpus.n || 0, ms: Date.now() - startedAt };
  }

  /** 语料规模：docs=N、avgdl=平均长度、terms=倒排词数 */
  function stats() {
    const corpus = s.corpus.get();
    return { docs: corpus.n || 0, avgdl: corpus.avgdl || 0, terms: s.termCount.get().n || 0 };
  }

  function dfOf(term) {
    return s.df.get(String(term))?.n || 0;
  }

  /** 命中任一词的候选：Map<key, Map<term, tf>>，外加每个词的 df。 */
  function candidates(terms) {
    const uniq = [...new Set((terms || []).filter(Boolean))].slice(0, 400);
    if (!uniq.length) return { hits: new Map(), df: new Map() };
    const hits = new Map();
    for (const row of db.prepare(`SELECT key, term, tf FROM postings WHERE term IN (${placeholders(uniq.length)})`).all(...uniq)) {
      let book = hits.get(row.key);
      if (!book) {
        book = new Map();
        hits.set(row.key, book);
      }
      book.set(row.term, row.tf);
    }
    const df = new Map();
    for (const t of uniq) df.set(t, dfOf(t));
    return { hits, df };
  }

  function docsByKeys(keys) {
    const list = [...keys];
    const out = [];
    for (let i = 0; i < list.length; i += 500) {
      const slice = list.slice(i, i + 500);
      if (!slice.length) continue;
      out.push(
        ...db
          .prepare(`SELECT key, rel, line_no, line, layer, ts, len, toks, hash, supersedes, until, voided FROM docs WHERE key IN (${placeholders(slice.length)})`)
          .all(...slice),
      );
    }
    return out;
  }

  /** 谁取代了谁（读时推导「已结束」用）。按同步次数缓存：每次检索都全表捞一遍太贵。 */
  let supersedesCache = null;
  function supersedesPairs() {
    if (!supersedesCache) supersedesCache = s.supersedes.all().map((r) => ({ hash: r.hash, supersedes: r.supersedes }));
    return supersedesCache;
  }

  function clear() {
    tx(() => {
      db.exec("DELETE FROM postings");
      db.exec("DELETE FROM docs");
      db.exec("DELETE FROM files");
      db.exec("DELETE FROM meta");
    });
  }

  function close() {
    try {
      db.close();
    } catch {
      /* 已关闭 */
    }
  }

  return { path: target, sync, stats, candidates, docsByKeys, supersedesPairs, dfOf, clear, close };
}

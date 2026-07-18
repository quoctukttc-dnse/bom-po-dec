/* =====================================================================
 * Decathlon — Mapping màu & size theo danh sách chuẩn hoá (ScaX → ScaF)
 * Hỗ trợ 2 loại file: Import PO (migrate) và BOM.
 * Chạy hoàn toàn trong trình duyệt (GitHub Pages).
 * ===================================================================== */

/* ---------------- Chuẩn hóa chuỗi ---------------- */
function norm(s) {
  if (s === null || s === undefined) return "";
  s = String(s).toUpperCase();
  s = s.replace(/[“”″]/g, '"').replace(/[‘’′]/g, "'");
  s = s.replace(/[ ​‌‍﻿]/g, " ");
  s = s.replace(/_X000D_/g, " ");
  s = s.replace(/[\r\n\t]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
/* Dạng "chặt": chỉ giữ A-Z0-9 — dùng để so khớp chứa (bỏ khác biệt space, gạch, ngoặc) */
function tight(s) { return norm(s).replace(/[^A-Z0-9]/g, ""); }
/* Bỏ dấu tiếng Việt (Trần → TRAN) để so tên người/khách hàng */
function stripVN(s) {
  return norm(String(s).normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "").replace(/đ/g, "d").replace(/Đ/g, "D"));
}
function cleanCode(v) {
  if (v === null || v === undefined) return "";
  let s = String(v).trim();
  if (/^\d+\.0$/.test(s)) s = s.slice(0, -2);
  return s;
}
const EMPTYISH = new Set(["", "UNKNOWN", "0", "0.0", "NULL", "N/A"]);
/* Mọi cụm số ≥5 chữ số trong chuỗi (mã labdip Decathlon, item code, model, DSM) */
function extractNums(s) {
  const m = String(s == null ? "" : s).match(/\d{5,}/g);
  return m ? [...new Set(m)] : [];
}
/* Số đứng đầu chuỗi màu cũ (vd "4638230 NO DYE" → "4638230") */
function leadNum(s) {
  const m = norm(s).match(/^(\d{5,})\b/);
  return m ? m[1] : "";
}
/* Tách số labdip/màu đứng đầu ra khỏi tên màu trước khi điền
 * ("4709795 N07A BLACK" → "N07A BLACK", "4709795-N07A BLACK" → "N07A BLACK").
 * Nếu tách xong rỗng (tên màu chỉ là số) thì giữ nguyên. */
function stripLeadNum(s) {
  const s0 = String(s == null ? "" : s).trim();
  const out = s0.replace(/^\d{5,}(?![0-9])[\s\-_/\.]*/, "").trim();
  return out || s0;
}

/* ---------------- Dữ liệu & chỉ mục ---------------- */
const DATA = { colors: null, generic: null, sku: null, ms: null, deca_npl: null, deca_tp: null, deca_fix: null, meta: null, sources: {} };
const MASTER_KEYS = ["colors", "generic", "sku", "ms", "deca_npl", "deca_tp", "deca_fix"];
const IDX = {};
const GRAM = 4;

function buildIndexes() {
  // ----- Color library (fallback khi màu không có trong chuẩn hoá) -----
  IDX.colorTight = [];
  IDX.colorGram = new Map();
  IDX.colorShort = [];
  IDX.colorByCode = new Map();
  IDX.colorCodesByName = new Map(); // tight(name) -> [codes] để tra code từ tên màu chuẩn hoá
  DATA.colors.forEach((c, i) => {
    const t = tight(c[1]);
    IDX.colorTight.push(t);
    IDX.colorByCode.set(cleanCode(c[0]), c[1]);
    if (t) {
      let arr = IDX.colorCodesByName.get(t);
      if (!arr) IDX.colorCodesByName.set(t, arr = []);
      arr.push(cleanCode(c[0]));
    }
    if (t.length >= GRAM) {
      const g = t.slice(0, GRAM);
      let arr = IDX.colorGram.get(g);
      if (!arr) IDX.colorGram.set(g, arr = []);
      arr.push(i);
    } else if (t.length === 3) {
      IDX.colorShort.push(i);
    }
  });
  // ----- Generic (fallback map item + cờ quản lý màu/size) -----
  IDX.genByScax = new Map();
  IDX.genByScaf = new Map(); // scaf -> dòng generic (ưu tiên APPROVE) — để tra cờ Manage By Color/Size
  DATA.generic.forEach(r => {
    const e = {
      scaf: cleanCode(r[0]), scax: cleanCode(r[1]), cnt: Number(r[2] || 0),
      mngColor: !!r[7], mngSize: !!r[8],
      status: String(r[9] || "").trim().toUpperCase(), block: !!r[10]
    };
    if (e.scaf) {
      const cur = IDX.genByScaf.get(e.scaf);
      if (!cur || (e.status === "APPROVE" && cur.status !== "APPROVE")) IDX.genByScaf.set(e.scaf, e);
    }
    if (!e.scax) return;
    let arr = IDX.genByScax.get(e.scax);
    if (!arr) IDX.genByScax.set(e.scax, arr = []);
    arr.push(e);
  });
  // ----- MS -----
  IDX.msList = (DATA.ms || []).map(r => {
    const u = cleanCode(r[0]), f = String(r[1] || "").trim();
    return { user: u, full: f, tokens: stripVN(f).split(" ").filter(Boolean), tFull: tight(stripVN(f)) };
  });
  // ----- SKU: item -> Map(colorCode -> colorName) -----
  IDX.skuColors = new Map();
  DATA.sku.forEach(r => {
    const item = cleanCode(r[0]), cc = cleanCode(r[2]);
    if (!item) return;
    let m = IDX.skuColors.get(item);
    if (!m) IDX.skuColors.set(item, m = new Map());
    if (cc) m.set(cc, r[3] || "");
  });

  // ===== CHUẨN HOÁ DECATHLON — NPL =====
  // row: [scax, scafOld, scafFinal, mauCu, mauMoi, sizeCu, sizeMoi, kieu, dsm, model, itemCode]
  IDX.nplByKey = new Map();
  (DATA.deca_npl || []).forEach(r => {
    const e = {
      scax: cleanCode(r[0]), scafOld: cleanCode(r[1]), scaf: cleanCode(r[2]),
      mauCu: String(r[3] || "").trim(), mauMoi: String(r[4] || "").trim(),
      sizeCu: String(r[5] || "").trim(), sizeMoi: String(r[6] || "").trim(),
      kieu: String(r[7] || "").trim(), dsm: cleanCode(r[8]), model: cleanCode(r[9]), itemCode: cleanCode(r[10])
    };
    e.tMauCu = tight(e.mauCu);
    e.mauCuNum = leadNum(e.mauCu);
    e.tSizeCu = tight(e.sizeCu);
    for (const k of [e.scax, e.scafOld, e.scaf]) {
      if (!k) continue;
      let arr = IDX.nplByKey.get(k);
      if (!arr) IDX.nplByKey.set(k, arr = []);
      if (!arr.includes(e)) arr.push(e);
    }
  });
  // ===== CHUẨN HOÁ DECATHLON — THÀNH PHẨM =====
  // row: [codeScaf, generic, moTa, mauCu, mauMoi, sizeCu, sizeMoi, colorCode, skuCode]
  IDX.tpByKey = new Map();
  (DATA.deca_tp || []).forEach(r => {
    const e = {
      code: cleanCode(r[0]), generic: cleanCode(r[1]), moTa: String(r[2] || "").trim(),
      mauCu: String(r[3] || "").trim(), mauMoi: String(r[4] || "").trim(),
      sizeCu: String(r[5] || "").trim(), sizeMoi: String(r[6] || "").trim(),
      colorCode: cleanCode(r[7]), skuCode: cleanCode(r[8])
    };
    e.tMauCu = tight(e.mauCu);
    e.mauCuNum = leadNum(e.mauCu);
    e.tSizeCu = tight(e.sizeCu);
    for (const k of [e.code, e.generic]) {
      if (!k) continue;
      let arr = IDX.tpByKey.get(k);
      if (!arr) IDX.tpByKey.set(k, arr = []);
      if (!arr.includes(e)) arr.push(e);
    }
  });
  // ===== DANH SÁCH LÀM SẠCH MODEL CODE KHỎI MÀU TP =====
  // row: [productCode, modelCode]
  IDX.fixByProd = new Map();
  (DATA.deca_fix || []).forEach(r => {
    const p = cleanCode(r[0]), m = cleanCode(r[1]);
    if (!p || !m) return;
    let s = IDX.fixByProd.get(p);
    if (!s) IDX.fixByProd.set(p, s = new Set());
    s.add(m);
  });
}

/* ---------------- Làm sạch model code khỏi chuỗi màu TP ----------------
 * Chỉ loại các model code có trong danh sách của đúng product code đó.
 * Trả về {cleaned, removed:[model...]} — cleaned === chuỗi gốc nếu không có gì để loại */
function cleanModelFromColor(prodCodes, colorStr) {
  const s0 = String(colorStr == null ? "" : colorStr);
  if (!s0.trim()) return { cleaned: s0, removed: [] };
  const models = new Set();
  for (const p of prodCodes) {
    const set = IDX.fixByProd.get(cleanCode(p));
    if (set) set.forEach(m => models.add(m));
  }
  if (!models.size) return { cleaned: s0, removed: [] };
  let s = s0;
  const removed = [];
  for (const m of models) {
    // loại model code đứng riêng (không dính vào số dài hơn), kèm dấu nối/ngoặc dư
    const re = new RegExp("[\\s\\-_/\\.]*(?<!\\d)" + m + "(?!\\d)[\\s\\-_/\\.]*", "g");
    if (re.test(s)) { s = s.replace(re, " "); removed.push(m); }
  }
  if (!removed.length) return { cleaned: s0, removed: [] };
  s = s.replace(/\s+/g, " ").replace(/^[\s\-_/\.]+|[\s\-_/\.]+$/g, "").trim();
  return { cleaned: s, removed };
}

/* ---------------- Matcher chuẩn hoá dùng chung ----------------
 * rows: các dòng chuẩn hoá của đúng mã hàng; colorOld/sizeOld: giá trị trên file.
 * Trả về {found, ambiguous, rows, mauMoi, mauMoiSet, level} */
function matchColorRows(rows, colorOld) {
  const tCol = tight(colorOld);
  const nums = extractNums(colorOld);
  let cands = [], level = "";
  // L1 — trùng mã số: số đầu của Màu CŨ hoặc Item code Decathlon
  if (nums.length) {
    cands = rows.filter(r => (r.mauCuNum && nums.includes(r.mauCuNum)) || (r.itemCode && nums.includes(r.itemCode)));
    if (cands.length) level = "số màu/item";
  }
  // L2 — trùng nguyên chuỗi màu
  if (!cands.length && tCol) {
    cands = rows.filter(r => r.tMauCu && r.tMauCu === tCol);
    if (cands.length) level = "trùng chuỗi";
  }
  // L3 — chuỗi chứa nhau (lấy phần khớp dài nhất, tối thiểu 4 ký tự)
  if (!cands.length && tCol) {
    let best = 0, sel = [];
    for (const r of rows) {
      if (!r.tMauCu || r.tMauCu.length < GRAM) continue;
      if (tCol.includes(r.tMauCu) || r.tMauCu.includes(tCol)) {
        const L = Math.min(r.tMauCu.length, tCol.length);
        if (L > best) { best = L; sel = [r]; }
        else if (L === best) sel.push(r);
      }
    }
    if (sel.length) { cands = sel; level = "chứa nhau"; }
  }
  // L4 — trùng Model hoặc DSM (chỉ NPL mới có)
  if (!cands.length && nums.length) {
    cands = rows.filter(r => (r.model && nums.includes(r.model)) || (r.dsm && nums.includes(r.dsm)));
    if (cands.length) level = "model/DSM";
  }
  if (!cands.length) return { found: false, ambiguous: false, rows: [], mauMoi: "", mauMoiSet: [], level: "" };
  // Nhiều màu mới khác nhau → thử thu hẹp bằng phần chữ của màu
  let mauSet = [...new Set(cands.map(r => r.mauMoi).filter(Boolean))];
  if (mauSet.length > 1 && tCol) {
    const narrowed = cands.filter(r => r.tMauCu && (tCol.includes(r.tMauCu) || r.tMauCu.includes(tCol)));
    if (narrowed.length) {
      const ns = [...new Set(narrowed.map(r => r.mauMoi).filter(Boolean))];
      if (ns.length < mauSet.length) { cands = narrowed; mauSet = ns; }
    }
  }
  return { found: true, ambiguous: mauSet.length > 1, rows: cands, mauMoi: mauSet.length === 1 ? mauSet[0] : "", mauMoiSet: mauSet, level };
}
/* Sau khi khớp màu: xử lý size trên tập dòng đã khớp.
 * sizeStatus: "" (không có size để kiểm) | OK | NOTINLIST */
function resolveSize(cands, sizeOld) {
  const tS = tight(sizeOld);
  if (!tS) return { sizeMoi: "", sizeStatus: "", rows: cands };
  const withSize = cands.filter(r => r.tSizeCu && r.tSizeCu === tS);
  if (withSize.length) return { sizeMoi: withSize[0].sizeMoi || withSize[0].sizeCu, sizeStatus: "OK", rows: withSize };
  return { sizeMoi: "", sizeStatus: "NOTINLIST", rows: cands };
}

/* ---------------- Chuẩn hoá NPL: OldItem + màu + size ---------------- */
/* Kiểm size trên TOÀN BỘ dòng chuẩn hoá của mã hàng (dùng khi màu không khớp được) */
function sizeAnywhere(rows, sizeOld) {
  const tS = tight(sizeOld);
  if (!tS) return "";
  return rows.some(r => r.tSizeCu === tS) ? "OK" : "NOTINLIST";
}
function matchNPL(oldItem, itemFilled, colorOld, sizeOld) {
  const keys = [cleanCode(oldItem), cleanCode(itemFilled)].filter(Boolean);
  let rows = null, usedKey = "";
  for (const k of keys) {
    const arr = IDX.nplByKey.get(k);
    if (arr && arr.length) { rows = arr; usedKey = k; break; }
  }
  if (!rows) return { inList: false, reason: "ITEM_NOT_IN_LIST", sizeStatus: "" };
  const cm = matchColorRows(rows, colorOld);
  if (!cm.found) return { inList: false, reason: "COLOR_NOT_IN_LIST", usedKey, sizeStatus: sizeAnywhere(rows, sizeOld) };
  let cands = cm.rows;
  // nếu màu chưa duy nhất mà có size → lọc thêm bằng size
  let sz = resolveSize(cands, sizeOld);
  if (cm.ambiguous && sz.sizeStatus === "OK") {
    const ns = [...new Set(sz.rows.map(r => r.mauMoi).filter(Boolean))];
    if (ns.length === 1) { cands = sz.rows; cm.ambiguous = false; cm.mauMoi = ns[0]; cm.mauMoiSet = ns; }
  }
  if (cm.ambiguous) return { inList: false, reason: "AMBIGUOUS", usedKey, mauMoiSet: cm.mauMoiSet, level: cm.level, sizeStatus: sizeAnywhere(rows, sizeOld) };
  sz = resolveSize(cands, sizeOld);
  const scafSet = [...new Set((sz.sizeStatus === "OK" ? sz.rows : cands).map(r => r.scaf).filter(Boolean))];
  const kieuSet = [...new Set(cands.map(r => r.kieu).filter(Boolean))];
  return {
    inList: true, usedKey, level: cm.level,
    mauMoi: cm.mauMoi,
    scaf: scafSet.length === 1 ? scafSet[0] : "",
    scafSet,
    sizeMoi: sz.sizeMoi, sizeStatus: sz.sizeStatus,
    kieu: kieuSet.join(" / ")
  };
}

/* ---------------- Chuẩn hoá THÀNH PHẨM: ProductCode + màu ---------------- */
function matchTP(prodOld, colorProdOld) {
  const rows = IDX.tpByKey.get(cleanCode(prodOld));
  if (!rows || !rows.length) return { inList: false, reason: "PRODUCT_NOT_IN_LIST" };
  const cm = matchColorRows(rows, colorProdOld);
  if (!cm.found) return { inList: false, reason: "COLOR_NOT_IN_LIST" };
  if (cm.ambiguous) return { inList: false, reason: "AMBIGUOUS", mauMoiSet: cm.mauMoiSet, level: cm.level };
  const codeSet = [...new Set(cm.rows.map(r => r.code).filter(Boolean))];
  const ccSet = [...new Set(cm.rows.map(r => r.colorCode).filter(Boolean))];
  const sizeMap = new Map(); // tight(sizeCu) -> sizeMoi
  cm.rows.forEach(r => { if (r.tSizeCu) sizeMap.set(r.tSizeCu, r.sizeMoi || r.sizeCu); });
  return {
    inList: true, level: cm.level,
    mauMoi: cm.mauMoi,
    code: codeSet.length === 1 ? codeSet[0] : "",
    colorCode: ccSet.length === 1 ? ccSet[0] : ccSet.join(", "),
    sizeMap
  };
}

/* ---------------- Fallback: dò màu trong Color Library ---------------- */
function findColorCandidates(tStr) {
  const found = [];
  const seen = new Set();
  for (const i of IDX.colorShort) {
    if (tStr.includes(IDX.colorTight[i])) { found.push(i); seen.add(i); }
  }
  for (let p = 0; p <= tStr.length - GRAM; p++) {
    const arr = IDX.colorGram.get(tStr.substr(p, GRAM));
    if (!arr) continue;
    for (const i of arr) {
      if (seen.has(i)) continue;
      seen.add(i);
      if (tStr.includes(IDX.colorTight[i])) found.push(i);
    }
  }
  return found;
}

/* ---------------- Map ScaX → ScaF (đã đơn giản hoá — tool chuyên Decathlon,
 * không kiểm khách hàng/NCC nữa) ---------------- */
function mapItem(scax) {
  const rows = IDX.genByScax.get(cleanCode(scax));
  if (!rows || !rows.length) return { item: "", note: "Không tìm thấy OldItem (ScaX) trong master" };
  const notes = [];
  const oper = rows.filter(r => r.status === "APPROVE" && !r.block);
  if (!oper.length) notes.push("⚠ Không có code vận hành (APPROVE, không block)");
  const pool = oper.length ? oper : rows;
  const chosen = pool.find(r => r.cnt < 999) || pool[0];
  const distinct = [...new Set(pool.map(r => r.scaf))];
  if (distinct.length > 1) notes.push("(" + distinct.length + " code ScaF ứng viên: " + distinct.join(", ") + " — cần rà)");
  if (chosen.cnt >= 999) notes.push("⚠ Code đã " + chosen.cnt + " SKU (giới hạn 999)");
  return { item: chosen.scaf, note: notes.join(" · ") };
}
/* Cờ quản lý màu của 1 mã hàng ScaF: true/false, hoặc null nếu không thấy trong master */
function itemManagesColor(scaf) {
  const e = IDX.genByScaf.get(cleanCode(scaf));
  return e ? !!e.mngColor : null;
}

/* ---------------- Chuẩn hóa MS (giữ nguyên logic cũ) ---------------- */
function matchMS(raw) {
  const r0 = String(raw == null ? "" : raw).trim();
  if (!r0) return { value: "", status: "EMPTY", candidates: [] };
  let q = r0;
  const mUser = q.match(/^(\d\.\d{4,})\s*[-–]?\s*(.*)$/);
  if (mUser) {
    const byUser = IDX.msList.find(m => m.user === mUser[1]);
    if (byUser) return { value: byUser.user + "-" + byUser.full, status: "OK", candidates: [byUser] };
    q = mUser[2] || q;
  }
  const qTokens = stripVN(q).split(" ").filter(Boolean);
  const qT = tight(stripVN(q));
  if (!qTokens.length) return { value: "", status: "NOTFOUND", candidates: [] };
  let hits = IDX.msList.filter(m => m.tFull === qT);
  if (!hits.length) hits = IDX.msList.filter(m => qTokens.every(t => m.tokens.includes(t)));
  if (!hits.length) hits = IDX.msList.filter(m => m.tFull.endsWith(qT));
  if (!hits.length) return { value: "", status: "NOTFOUND", candidates: [] };
  if (hits.length === 1) return { value: hits[0].user + "-" + hits[0].full, status: "OK", candidates: hits };
  return { value: "", status: "AMBIGUOUS", candidates: hits.slice(0, 6) };
}

/* ---------------- Tra mã màu Color Library từ tên màu chuẩn hoá (để kiểm SKU) ---------------- */
function skuCheck(item, mauMoi) {
  if (!item || !mauMoi) return { checked: false };
  const skuMap = IDX.skuColors.get(item);
  const codes = IDX.colorCodesByName.get(tight(mauMoi)) || [];
  if (!codes.length) return { checked: true, colorInLib: false, skuExists: false, codes: [] };
  if (skuMap) {
    const hit = codes.find(c => skuMap.has(c));
    if (hit) return { checked: true, colorInLib: true, skuExists: true, codes: [hit] };
  }
  return { checked: true, colorInLib: true, skuExists: false, codes: codes.slice(0, 5) };
}

/* =====================================================================
 * XỬ LÝ 1 DÒNG — thuần dữ liệu (dùng được cả trong Node để test)
 * ===================================================================== */

/* ---- Import PO: vào {OldItem, Item, ColorItemOld, ColorItem, RMSizeOld, RMSize, MS}
 * ra {fills:{Item, ColorItem, RMSize, MS}, ...cờ báo cáo} — KHÔNG đụng cột Lapdip ---- */
function processPORow(g) {
  const res = {
    fills: {}, status: [],
    item: cleanCode(g.Item), itemSource: "", mauMoi: "", colorSource: "",
    colorOutOfList: false, colorNotFound: false, sizeOutOfList: false,
    skuMissing: false, skuColorCodes: [], itemNotMapped: false, noColorMng: false,
    msStatus: "", msValue: "", msCandidates: ""
  };
  const oldItem = cleanCode(g.OldItem);
  if (!oldItem && !res.item) return res;

  const sizeOld = String(g.RMSizeOld || "").trim() || String(g.RMSize || "").trim();
  const npl = matchNPL(oldItem, res.item, g.ColorItemOld, sizeOld);

  // ---- Item ----
  if (!res.item) {
    if (npl.inList && npl.scaf) {
      res.item = npl.scaf;
      res.itemSource = "chuanhoa";
      res.status.push("Item theo chuẩn hoá Decathlon: " + npl.scaf);
    } else {
      const m = mapItem(oldItem);
      res.item = m.item;
      res.itemSource = res.item ? "master" : "";
      if (res.item) res.status.push("Item dò master: " + res.item + (m.note ? " · " + m.note : ""));
      else { res.itemNotMapped = true; res.status.push("✗ KHÔNG MAP ĐƯỢC ITEM" + (m.note ? ": " + m.note : "")); }
    }
    if (res.item) res.fills.Item = res.item;
  } else if (npl.inList && npl.scaf && npl.scaf !== res.item) {
    res.status.push("⚠ Item trên file (" + res.item + ") ≠ chuẩn hoá (" + npl.scaf + ") — cần rà");
  }

  // ---- Màu ----
  // Mã hàng KHÔNG quản lý màu (Manage By Color = False) → không điền ColorItem
  const mngColor = itemManagesColor(res.item);
  const colorOld = norm(g.ColorItemOld);
  if (res.item && mngColor === false) {
    res.noColorMng = true;
    res.status.push("Item " + res.item + " KHÔNG quản lý màu — không điền ColorItem");
  } else if (colorOld) {
    if (npl.inList && npl.mauMoi) {
      res.mauMoi = npl.mauMoi;
      res.colorSource = "chuanhoa";
      const nameOnly = stripLeadNum(npl.mauMoi);
      res.fills.ColorItem = nameOnly;
      res.status.push("Màu theo chuẩn hoá (" + npl.level + "): " + nameOnly +
        (nameOnly !== npl.mauMoi ? " (tách số khỏi «" + npl.mauMoi + "»)" : "") + (npl.kieu ? " [" + npl.kieu + "]" : ""));
    } else if (npl.inList && !npl.mauMoi) {
      res.status.push("Khớp chuẩn hoá (" + npl.level + ") nhưng Màu MỚI để trống" + (npl.kieu ? " [" + npl.kieu + "]" : "") + " — không điền ColorItem");
    } else {
      res.colorOutOfList = true;
      const why = npl.reason === "AMBIGUOUS" ? "nhiều màu mới ứng viên: " + (npl.mauMoiSet || []).join(" | ")
        : npl.reason === "ITEM_NOT_IN_LIST" ? "mã hàng không có trong danh sách chuẩn hoá"
          : "màu không có trong danh sách chuẩn hoá";
      // fallback: dò Color Library như logic cũ
      const candIdx = findColorCandidates(tight(colorOld));
      const skuMap = IDX.skuColors.get(res.item);
      const cands = candIdx.map(i => {
        const code = cleanCode(DATA.colors[i][0]);
        return { code, name: DATA.colors[i][1], len: IDX.colorTight[i].length, hasSku: skuMap && skuMap.has(code) ? 1 : 0 };
      }).sort((a, b) => (b.len - a.len) || (b.hasSku - a.hasSku));
      if (cands.length) {
        // Điền TÊN màu (đã tách số đứng đầu) — mã màu chỉ dùng nội bộ để kiểm SKU và ghi trong báo cáo
        res.mauMoi = cands[0].code;
        res.colorSource = "master";
        res.fills.ColorItem = stripLeadNum(cands[0].name);
        res.status.push("⚠ Ngoài chuẩn hoá (" + why + ") — dò Color Library: " + stripLeadNum(cands[0].name) + " [mã " + cands[0].code + "]");
      } else {
        res.colorNotFound = true;
        res.status.push("✗ Ngoài chuẩn hoá (" + why + ") và KHÔNG dò được trong Color Library — để trống");
      }
    }
  } else {
    res.status.push("ColorItemOld trống — bỏ qua màu");
  }

  // ---- Size ----
  if (sizeOld) {
    if (npl.inList && npl.sizeStatus === "OK" && npl.sizeMoi) {
      res.fills.RMSize = npl.sizeMoi;
      if (tight(npl.sizeMoi) !== tight(sizeOld)) res.status.push("Size chuẩn hoá: " + sizeOld + " → " + npl.sizeMoi);
    } else if (npl.sizeStatus === "NOTINLIST") {
      res.sizeOutOfList = true;
      res.status.push("⚠ Size «" + sizeOld + "» KHÔNG có trong chuẩn hoá NPL");
    } else if (!npl.inList && npl.sizeStatus === "OK") {
      res.status.push("Size «" + sizeOld + "» có trong chuẩn hoá (dù màu không khớp được)");
    }
  }

  // ---- Kiểm SKU (khi màu lấy từ chuẩn hoá) ----
  if (res.item && res.colorSource === "chuanhoa") {
    const sc = skuCheck(res.item, res.mauMoi);
    if (sc.checked && sc.colorInLib && sc.skuExists) res.status.push("SKU đã có (" + sc.codes[0] + ")");
    else if (sc.checked && sc.colorInLib) { res.skuMissing = true; res.skuColorCodes = sc.codes; res.status.push("⚠ CẦN TẠO SKU: " + res.item + " / màu " + res.mauMoi + " (mã màu: " + sc.codes.join(", ") + ")"); }
    else if (sc.checked) res.status.push("⚠ Tên màu «" + res.mauMoi + "» chưa có trong Color Library — kiểm tra khi tạo SKU");
  } else if (res.item && res.colorSource === "master") {
    const skuMap = IDX.skuColors.get(res.item);
    if (skuMap && skuMap.has(res.mauMoi)) res.status.push("SKU đã có (" + res.mauMoi + ")");
    else { res.skuMissing = true; res.skuColorCodes = [res.mauMoi]; res.status.push("⚠ CẦN TẠO SKU: " + res.item + " / " + res.mauMoi); }
  }

  // ---- MS ----
  const msRaw = String(g.MS || "").trim();
  const ms = matchMS(msRaw);
  res.msRaw = msRaw; res.msStatus = ms.status; res.msValue = ms.value;
  res.msCandidates = ms.candidates.map(c => c.user + "-" + c.full).join("; ");
  if (ms.status === "OK") { res.fills.MS = ms.value; if (ms.value !== msRaw) res.status.push("MS chuẩn hóa: " + ms.value); }
  if (ms.status === "NOTFOUND") res.status.push("✗ MS «" + msRaw + "» không thấy trong danh sách MS ScaF");
  if (ms.status === "AMBIGUOUS") res.status.push("⚠ MS «" + msRaw + "» có " + ms.candidates.length + " ứng viên: " + res.msCandidates);
  return res;
}

/* ---- BOM: vào {ProductCodeOld, ProductCode, OldItem, Item, ColorProductOld, ColorProduct,
 *               ColorItemOld, ColorItem, RMSize, ProductSize}
 * ra {fills:{ProductCode, Item, ColorProduct, ColorItem, RMSize}, ...cờ báo cáo} ---- */
function processBOMRow(g) {
  const res = {
    fills: {}, status: [],
    tpOutOfList: false, nplOutOfList: false, sizeOutOfList: false,
    itemNotMapped: false, prodSizeMissing: [], modelCleaned: false, noColorMng: false
  };
  // ===== THÀNH PHẨM =====
  const prodOld = cleanCode(g.ProductCodeOld);
  const colorProdOld = norm(g.ColorProductOld);
  let tp = null;
  if (prodOld) {
    tp = matchTP(prodOld, colorProdOld);
    const prodKeys = [prodOld, cleanCode(g.ProductCode), tp.inList ? tp.code : ""].filter(Boolean);
    if (tp.inList) {
      if (tp.code && !cleanCode(g.ProductCode)) { res.fills.ProductCode = tp.code; res.status.push("ProductCode chuẩn hoá: " + tp.code); }
      if (colorProdOld && tp.mauMoi) {
        // Làm sạch model code (danh sách "loại model code ra khỏi màu") trên giá trị Màu MỚI
        const fx = cleanModelFromColor(prodKeys, tp.mauMoi);
        res.fills.ColorProduct = fx.cleaned;
        if (fx.removed.length) {
          res.modelCleaned = true;
          res.status.push("Màu TP chuẩn hoá (" + tp.level + ") + LÀM SẠCH model code " + fx.removed.join(", ") + ": «" + tp.mauMoi + "» → «" + fx.cleaned + "»" + (tp.colorCode ? " [ColorCode " + tp.colorCode + "]" : ""));
        } else {
          res.status.push("Màu TP chuẩn hoá (" + tp.level + "): " + tp.mauMoi + (tp.colorCode ? " [ColorCode " + tp.colorCode + "]" : ""));
        }
      }
      // ProductSize: chỉ kiểm tra, không sửa
      const psRaw = String(g.ProductSize || "").trim();
      if (psRaw && tp.sizeMap && tp.sizeMap.size) {
        const missing = psRaw.split(/[,;]/).map(s => s.trim()).filter(Boolean).filter(s => !tp.sizeMap.has(tight(s)));
        if (missing.length) { res.prodSizeMissing = missing; res.status.push("⚠ Size TP ngoài chuẩn hoá: " + missing.join(", ")); }
      }
    } else if (colorProdOld) {
      // Ngoài chuẩn hoá: nếu product code nằm trong danh sách làm sạch và màu chứa model code → làm sạch rồi điền luôn
      const fx = cleanModelFromColor(prodKeys, String(g.ColorProductOld || "").trim() || colorProdOld);
      if (fx.removed.length) {
        res.modelCleaned = true;
        res.fills.ColorProduct = fx.cleaned;
        res.status.push("LÀM SẠCH model code " + fx.removed.join(", ") + " (ngoài chuẩn hoá): «" + colorProdOld + "» → «" + fx.cleaned + "» — đã điền ColorProduct");
      } else {
        res.tpOutOfList = true;
        const why = tp.reason === "AMBIGUOUS" ? "nhiều màu mới ứng viên: " + (tp.mauMoiSet || []).join(" | ")
          : tp.reason === "PRODUCT_NOT_IN_LIST" ? "mã TP không có trong danh sách chuẩn hoá"
            : "màu không có trong danh sách chuẩn hoá";
        res.status.push("✗ Màu TP ngoài chuẩn hoá (" + why + ") — để trống ColorProduct");
      }
    }
  }
  // ===== NGUYÊN PHỤ LIỆU =====
  const oldItem = cleanCode(g.OldItem);
  const itemFilled = cleanCode(g.Item);
  const colorItemOld = norm(g.ColorItemOld);
  const rmSize = String(g.RMSize || "").trim();
  if (oldItem || itemFilled) {
    const npl = matchNPL(oldItem, itemFilled, colorItemOld, rmSize);
    // ---- Item ----
    if (npl.inList) {
      if (!itemFilled && npl.scaf) { res.fills.Item = npl.scaf; res.status.push("Item chuẩn hoá: " + npl.scaf); }
      else if (itemFilled && npl.scaf && npl.scaf !== itemFilled) res.status.push("⚠ Item trên file (" + itemFilled + ") ≠ chuẩn hoá (" + npl.scaf + ") — cần rà");
    } else if (!itemFilled) {
      const m = mapItem(oldItem);
      if (m.item) { res.fills.Item = m.item; res.status.push("Item dò master: " + m.item + (m.note ? " · " + m.note : "")); }
      else { res.itemNotMapped = true; res.status.push("✗ Không map được Item: " + (m.note || "")); }
    }
    const finalItem = itemFilled || res.fills.Item || "";
    const mngColor = itemManagesColor(finalItem);
    // ---- Màu ----
    if (finalItem && mngColor === false) {
      res.noColorMng = true;
      if (colorItemOld) res.status.push("Item " + finalItem + " KHÔNG quản lý màu — không điền ColorItem");
    } else if (npl.inList) {
      if (colorItemOld && npl.mauMoi) {
        const nameOnly = stripLeadNum(npl.mauMoi);
        res.fills.ColorItem = nameOnly;
        res.status.push("Màu NPL chuẩn hoá (" + npl.level + "): " + nameOnly +
          (nameOnly !== npl.mauMoi ? " (tách số khỏi «" + npl.mauMoi + "»)" : "") + (npl.kieu ? " [" + npl.kieu + "]" : ""));
      } else if (colorItemOld && !npl.mauMoi) {
        res.status.push("Khớp chuẩn hoá (" + npl.level + ") nhưng Màu MỚI để trống" + (npl.kieu ? " [" + npl.kieu + "]" : "") + " — không điền ColorItem");
      }
    } else if (colorItemOld) {
      res.nplOutOfList = true;
      const why = npl.reason === "AMBIGUOUS" ? "nhiều màu mới ứng viên: " + (npl.mauMoiSet || []).join(" | ")
        : npl.reason === "ITEM_NOT_IN_LIST" ? "mã NPL không có trong danh sách chuẩn hoá"
          : "màu không có trong danh sách chuẩn hoá";
      res.status.push("✗ Màu NPL ngoài chuẩn hoá (" + why + ") — để trống ColorItem");
    }
    // ---- Size ----
    if (rmSize) {
      if (npl.inList && npl.sizeStatus === "OK" && npl.sizeMoi) {
        if (tight(npl.sizeMoi) !== tight(rmSize)) { res.fills.RMSize = npl.sizeMoi; res.status.push("Size NPL chuẩn hoá: " + rmSize + " → " + npl.sizeMoi); }
        else res.status.push("Size NPL trong chuẩn hoá: " + rmSize);
      } else if (npl.sizeStatus === "NOTINLIST") {
        res.sizeOutOfList = true;
        res.status.push("⚠ Size NPL «" + rmSize + "» KHÔNG có trong chuẩn hoá" + (npl.inList ? "" : " của mã hàng này"));
      } else if (!npl.inList && npl.sizeStatus === "OK") {
        res.status.push("Size NPL «" + rmSize + "» có trong chuẩn hoá (dù màu không khớp được)");
      }
    }
  }
  return res;
}

/* =====================================================================
 * PHẦN DƯỚI: chỉ chạy trong trình duyệt
 * ===================================================================== */
if (typeof document !== "undefined") {

  /* ---------- IndexedDB ---------- */
  function idb() {
    return new Promise((ok, err) => {
      const rq = indexedDB.open("deca-mapping", 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore("masters");
      rq.onsuccess = () => ok(rq.result);
      rq.onerror = () => err(rq.error);
    });
  }
  async function idbGet(key) {
    const db = await idb();
    return new Promise((ok, err) => {
      const rq = db.transaction("masters").objectStore("masters").get(key);
      rq.onsuccess = () => ok(rq.result); rq.onerror = () => err(rq.error);
    });
  }
  async function idbSet(key, val) {
    const db = await idb();
    return new Promise((ok, err) => {
      const tx = db.transaction("masters", "readwrite");
      tx.objectStore("masters").put(val, key);
      tx.oncomplete = () => ok(); tx.onerror = () => err(tx.error);
    });
  }
  async function idbDel(keys) {
    const db = await idb();
    return new Promise((ok, err) => {
      const tx = db.transaction("masters", "readwrite");
      keys.forEach(k => tx.objectStore("masters").delete(k));
      tx.oncomplete = () => ok(); tx.onerror = () => err(tx.error);
    });
  }

  /* ---------- Tải master ---------- */
  async function fetchGz(name) {
    const r = await fetch("data/" + name + ".json.gz", { cache: "no-store" });
    if (!r.ok) throw new Error("Không tải được data/" + name + ".json.gz (HTTP " + r.status + ")");
    const buf = new Uint8Array(await r.arrayBuffer());
    const bytes = (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) ? pako.inflate(buf) : buf;
    const txt = new TextDecoder("utf-8").decode(bytes);
    const c0 = txt.trimStart().charAt(0);
    if (c0 !== "[" && c0 !== "{") throw new Error("data/" + name + ".json.gz trả về nội dung lạ (bắt đầu bằng «" + txt.slice(0, 30) + "…»). Kiểm tra file có được upload đầy đủ lên server không.");
    return JSON.parse(txt);
  }
  async function loadMasters() {
    const st = document.getElementById("masterStatus");
    try {
      for (const k of MASTER_KEYS) {
        const local = await idbGet(k);
        if (local) { DATA[k] = local.rows; DATA.sources[k] = "Upload " + local.date; }
      }
      const need = MASTER_KEYS.filter(k => !DATA[k]);
      if (need.length) {
        st.textContent = "Đang tải dữ liệu nhúng (" + need.join(", ") + ")…";
        for (const k of need) { DATA[k] = await fetchGz(k); DATA.sources[k] = "Bản nhúng trong website"; }
      }
      buildIndexes();
      st.innerHTML =
        '<span class="pill ok">Chuẩn hoá NPL: ' + DATA.deca_npl.length.toLocaleString() + " dòng</span>" +
        '<span class="pill ok">Chuẩn hoá TP: ' + DATA.deca_tp.length.toLocaleString() + " dòng</span>" +
        '<span class="pill ok">Làm sạch model code: ' + DATA.deca_fix.length.toLocaleString() + " cặp</span>" +
        '<span class="pill ok">Color Library: ' + DATA.colors.length.toLocaleString() + " màu</span>" +
        '<span class="pill ok">Generic: ' + DATA.generic.length.toLocaleString() + " code</span>" +
        '<span class="pill ok">SKU: ' + DATA.sku.length.toLocaleString() + " dòng</span>" +
        '<span class="pill ok">MS: ' + DATA.ms.length.toLocaleString() + "</span>" +
        '<br><span class="small">Nguồn: ChuẩnHoáNPL=' + DATA.sources.deca_npl + " · ChuẩnHoáTP=" + DATA.sources.deca_tp +
        " · Color=" + DATA.sources.colors + " · Items=" + DATA.sources.generic + " · MS=" + DATA.sources.ms + "</span>";
      document.getElementById("btnRun").disabled = !uploadedFile;
      refreshAdmin();
    } catch (e) {
      st.innerHTML = '<span class="pill err">Lỗi tải master: ' + e.message + "</span><br>" +
        '<span class="small">Nếu mở file trực tiếp (file://), trình duyệt chặn fetch. Hãy chạy qua GitHub Pages hoặc server cục bộ: <code>python -m http.server</code></span>';
    }
  }

  /* ---------- Upload file cần xử lý ---------- */
  let uploadedFile = null, uploadedWB = null, results = null, headerMap = null, origName = "", fileKind = "";
  const dz = document.getElementById("dropZone"), fi = document.getElementById("fileInput");
  dz.onclick = () => fi.click();
  dz.ondragover = e => { e.preventDefault(); dz.classList.add("drag"); };
  dz.ondragleave = () => dz.classList.remove("drag");
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove("drag"); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); };
  fi.onchange = () => { if (fi.files[0]) setFile(fi.files[0]); };

  async function setFile(f) {
    uploadedFile = f; origName = f.name.replace(/\.xlsx?$/i, "");
    document.getElementById("btnRun").disabled = true;
    document.getElementById("resultCard").classList.add("hidden");
    const st = document.getElementById("fileStatus");
    st.textContent = "Đang đọc " + f.name + "…";
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await f.arrayBuffer());
      uploadedWB = wb;
      const ws = wb.worksheets[0];
      headerMap = {};
      ws.getRow(1).eachCell((cell, col) => { headerMap[String(cell.value).trim()] = col; });
      // Nhận diện loại file
      if (headerMap["ProductCodeOld"] && headerMap["ColorProductOld"]) {
        fileKind = "BOM";
        const required = ["ProductCodeOld", "ProductCode", "OldItem", "Item", "ColorProductOld", "ColorProduct", "ColorItemOld", "ColorItem"];
        const missing = required.filter(h => !headerMap[h]);
        if (missing.length) { st.innerHTML = '<span class="pill err">File BOM thiếu cột: ' + missing.join(", ") + "</span>"; uploadedFile = null; return; }
      } else if (headerMap["OldItem"] && headerMap["ColorItemOld"]) {
        fileKind = "PO";
        const required = ["OldItem", "Item", "ColorItemOld", "ColorItem"];
        const missing = required.filter(h => !headerMap[h]);
        if (missing.length) { st.innerHTML = '<span class="pill err">File Import PO thiếu cột: ' + missing.join(", ") + "</span>"; uploadedFile = null; return; }
      } else {
        st.innerHTML = '<span class="pill err">Không nhận diện được loại file (cần cột OldItem+ColorItemOld cho Import PO, hoặc ProductCodeOld+ColorProductOld cho BOM)</span>';
        uploadedFile = null; return;
      }
      let n = 0;
      ws.eachRow((row, rn) => { if (rn > 1) n++; });
      st.innerHTML = '<span class="pill ok">' + f.name + " — " + n + " dòng, sheet «" + ws.name + "» — nhận diện: <b>" +
        (fileKind === "BOM" ? "File BOM thành phẩm" : "File Import PO") + "</b></span>";
      document.getElementById("btnRun").disabled = !DATA.colors;
    } catch (e) {
      st.innerHTML = '<span class="pill err">Không đọc được file: ' + e.message + "</span>";
      uploadedFile = null;
    }
  }

  /* ---------- Chạy xử lý ---------- */
  window.runProcess = async function () {
    if (!uploadedWB || !DATA.colors) return;
    const ws = uploadedWB.worksheets[0];
    const H = headerMap;
    const prog = document.getElementById("prog");
    prog.classList.remove("hidden");
    results = [];
    const rows = [];
    ws.eachRow((row, rn) => { if (rn > 1) rows.push(rn); });
    let done = 0;
    for (const rn of rows) {
      const row = ws.getRow(rn);
      const get = h => {
        const c = H[h] ? row.getCell(H[h]).value : null;
        return c === null || c === undefined ? "" : (typeof c === "object" && c.richText ? c.richText.map(t => t.text).join("") : String(c));
      };
      const g = {};
      for (const h in H) g[h] = get(h);
      let r;
      if (fileKind === "PO") {
        if (!cleanCode(g.OldItem) && !cleanCode(g.Item)) { done++; continue; }
        r = processPORow(g);
      } else {
        if (!cleanCode(g.ProductCodeOld) && !cleanCode(g.OldItem) && !cleanCode(g.Item)) { done++; continue; }
        r = processBOMRow(g);
      }
      // Ghi giá trị vào file (chỉ những cột có trong fills)
      for (const col in r.fills) {
        if (H[col] && r.fills[col] !== undefined && r.fills[col] !== "") row.getCell(H[col]).value = r.fills[col];
      }
      results.push(Object.assign({
        rowNum: rn,
        oldItem: cleanCode(g.OldItem), prodOld: cleanCode(g.ProductCodeOld || ""),
        colorOld: norm(g.ColorItemOld), colorProdOld: norm(g.ColorProductOld || ""),
        sizeOld: String(g.RMSizeOld || g.RMSize || "").trim(),
        customer: ""
      }, r));
      done++;
      if (done % 200 === 0) { prog.value = done / rows.length * 100; await new Promise(x => setTimeout(x)); }
    }
    prog.value = 100;
    setTimeout(() => prog.classList.add("hidden"), 800);
    renderResults();
  };

  /* ---------- Tổng hợp báo cáo ---------- */
  function agg() {
    const skuNew = new Map(), colorOut = [], sizeOut = [], msIssues = [], newCode = [], tpOut = [], itemFail = [], cleaned = [], noMng = [];
    for (const r of results) {
      if (r.msStatus === "NOTFOUND" || r.msStatus === "AMBIGUOUS") msIssues.push(r);
      if (r.itemNotMapped) newCode.push(r);
      if (r.modelCleaned) cleaned.push(r);
      if (r.noColorMng) noMng.push(r);
      if (r.skuMissing) {
        const k = (r.fills.Item || r.item) + "|" + (r.skuColorCodes || []).join(",");
        if (!skuNew.has(k)) skuNew.set(k, { item: r.fills.Item || r.item, mauMoi: r.mauMoi, codes: (r.skuColorCodes || []).join(", "), rows: [] });
        skuNew.get(k).rows.push(r.rowNum);
      }
      if (r.colorOutOfList || r.nplOutOfList || r.colorNotFound) colorOut.push(r);
      if (r.tpOutOfList) tpOut.push(r);
      if (r.sizeOutOfList || (r.prodSizeMissing && r.prodSizeMissing.length)) sizeOut.push(r);
    }
    return { skuNew: [...skuNew.values()], colorOut, sizeOut, msIssues, newCode, tpOut, itemFail, cleaned, noMng };
  }

  function renderResults() {
    const a = agg();
    document.getElementById("resultCard").classList.remove("hidden");
    const okCnt = results.filter(r => !r.colorOutOfList && !r.nplOutOfList && !r.tpOutOfList && !r.sizeOutOfList && !r.colorNotFound && !r.itemNotMapped).length;
    document.getElementById("summaryBoxes").innerHTML =
      '<div class="sumbox"><b>' + results.length + "</b><span>Tổng dòng (" + (fileKind === "BOM" ? "BOM" : "Import PO") + ")</span></div>" +
      '<div class="sumbox"><b style="color:var(--ok)">' + okCnt + "</b><span>Khớp chuẩn hoá đầy đủ</span></div>" +
      '<div class="sumbox"><b style="color:var(--err)">' + a.colorOut.length + "</b><span>Màu NPL ngoài chuẩn hoá</span></div>" +
      '<div class="sumbox"><b>' + a.noMng.length + "</b><span>Không quản lý màu (bỏ qua)</span></div>" +
      (fileKind === "BOM" ? '<div class="sumbox"><b style="color:var(--err)">' + a.tpOut.length + "</b><span>Màu TP ngoài chuẩn hoá</span></div>" : "") +
      (fileKind === "BOM" ? '<div class="sumbox"><b style="color:var(--warn)">' + a.cleaned.length + "</b><span>Đã làm sạch model code</span></div>" : "") +
      '<div class="sumbox"><b style="color:var(--warn)">' + a.sizeOut.length + "</b><span>Size ngoài chuẩn hoá</span></div>" +
      (fileKind === "PO" ? '<div class="sumbox"><b style="color:var(--warn)">' + a.skuNew.length + "</b><span>SKU cần tạo</span></div>" : "") +
      (fileKind === "PO" ? '<div class="sumbox"><b style="color:var(--warn)">' + a.msIssues.length + "</b><span>MS cần kiểm tra</span></div>" : "") +
      (a.newCode.length ? '<div class="sumbox"><b style="color:var(--err)">' + a.newCode.length + "</b><span>Không map được Item</span></div>" : "");
    document.getElementById("tabTP").style.display = fileKind === "BOM" ? "" : "none";
    document.getElementById("tabClean").style.display = fileKind === "BOM" ? "" : "none";
    document.getElementById("tabSKU").style.display = fileKind === "PO" ? "" : "none";
    document.getElementById("tabMS").style.display = fileKind === "PO" ? "" : "none";
    showResultTable(document.querySelector('#resultTabs button[data-rt="all"]'));
  }

  window.showResultTable = function (btn) {
    document.querySelectorAll("#resultTabs .tabs button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const t = document.getElementById("resultTable");
    const esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const a = agg();
    const kind = btn.dataset.rt;
    if (kind === "all") {
      if (fileKind === "PO") {
        t.innerHTML = "<tr><th>Dòng</th><th>OldItem</th><th>Item</th><th>ColorItemOld</th><th>ColorItem điền</th><th>RMSize điền</th><th>Trạng thái</th></tr>" +
          results.map(r => "<tr><td>" + r.rowNum + "</td><td>" + esc(r.oldItem) + "</td><td>" + esc(r.fills.Item || r.item) + "</td><td>" + esc(r.colorOld) +
            "</td><td>" + esc(r.fills.ColorItem || "") + "</td><td>" + esc(r.fills.RMSize || "") + "</td><td>" + esc(r.status.join(" · ")) + "</td></tr>").join("");
      } else {
        t.innerHTML = "<tr><th>Dòng</th><th>TP cũ</th><th>Màu TP cũ</th><th>ColorProduct điền</th><th>OldItem</th><th>Item điền</th><th>Màu NPL cũ</th><th>ColorItem điền</th><th>RMSize điền</th><th>Trạng thái</th></tr>" +
          results.map(r => "<tr><td>" + r.rowNum + "</td><td>" + esc(r.prodOld) + "</td><td>" + esc(r.colorProdOld) + "</td><td>" + esc(r.fills.ColorProduct || "") +
            "</td><td>" + esc(r.oldItem) + "</td><td>" + esc(r.fills.Item || "") + "</td><td>" + esc(r.colorOld) + "</td><td>" + esc(r.fills.ColorItem || "") +
            "</td><td>" + esc(r.fills.RMSize || "") + "</td><td>" + esc(r.status.join(" · ")) + "</td></tr>").join("");
      }
    } else if (kind === "colorout") {
      t.innerHTML = "<tr><th>Dòng</th><th>OldItem</th><th>Màu NPL cũ</th><th>Lý do / fallback</th></tr>" +
        a.colorOut.map(r => "<tr><td>" + r.rowNum + "</td><td>" + esc(r.oldItem) + "</td><td>" + esc(r.colorOld) + "</td><td>" + esc(r.status.join(" · ")) + "</td></tr>").join("");
    } else if (kind === "cleaned") {
      t.innerHTML = "<tr><th>Dòng</th><th>TP cũ</th><th>Màu TP cũ</th><th>ColorProduct đã điền</th><th>Chi tiết</th></tr>" +
        a.cleaned.map(r => "<tr><td>" + r.rowNum + "</td><td>" + esc(r.prodOld) + "</td><td>" + esc(r.colorProdOld) + "</td><td>" + esc(r.fills.ColorProduct || "") + "</td><td>" + esc(r.status.join(" · ")) + "</td></tr>").join("");
    } else if (kind === "tpout") {
      t.innerHTML = "<tr><th>Dòng</th><th>TP cũ</th><th>Màu TP cũ</th><th>Lý do</th></tr>" +
        a.tpOut.map(r => "<tr><td>" + r.rowNum + "</td><td>" + esc(r.prodOld) + "</td><td>" + esc(r.colorProdOld) + "</td><td>" + esc(r.status.join(" · ")) + "</td></tr>").join("");
    } else if (kind === "sizeout") {
      t.innerHTML = "<tr><th>Dòng</th><th>Mã hàng</th><th>Size trên file</th><th>Ghi chú</th></tr>" +
        a.sizeOut.map(r => "<tr><td>" + r.rowNum + "</td><td>" + esc(r.oldItem || r.prodOld) + "</td><td>" + esc(r.sizeOld + ((r.prodSizeMissing || []).length ? " / TP: " + r.prodSizeMissing.join(",") : "")) + "</td><td>" + esc(r.status.join(" · ")) + "</td></tr>").join("");
    } else if (kind === "sku") {
      t.innerHTML = "<tr><th>Item</th><th>Màu mới</th><th>Mã màu ứng viên</th><th>Dòng liên quan</th></tr>" +
        a.skuNew.map(r => "<tr><td>" + esc(r.item) + "</td><td>" + esc(r.mauMoi) + "</td><td>" + esc(r.codes) + "</td><td>" + r.rows.join(", ") + "</td></tr>").join("");
    } else if (kind === "ms") {
      t.innerHTML = "<tr><th>Dòng</th><th>MS gốc</th><th>Tình trạng</th><th>Ứng viên</th></tr>" +
        a.msIssues.map(r => "<tr><td>" + r.rowNum + "</td><td>" + esc(r.msRaw) + "</td><td>" + (r.msStatus === "NOTFOUND" ? "Không thấy" : "Nhiều ứng viên") + "</td><td>" + esc(r.msCandidates) + "</td></tr>").join("");
    } else {
      t.innerHTML = "<tr><th>Dòng</th><th>OldItem / TP</th><th>Ghi chú</th></tr>" +
        a.newCode.map(r => "<tr><td>" + r.rowNum + "</td><td>" + esc(r.oldItem || r.prodOld) + "</td><td>" + esc(r.status.join(" · ")) + "</td></tr>").join("");
    }
  };

  /* ---------- Tải file xuống ---------- */
  function saveBlob(buf, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  window.downloadFilled = async function () {
    const buf = await uploadedWB.xlsx.writeBuffer();
    saveBlob(buf, origName + "_da_dien.xlsx");
  };
  window.downloadReport = async function () {
    const a = agg();
    const wb = new ExcelJS.Workbook();
    const bold = { font: { bold: true } };
    const add = (name, headers, rows) => {
      const ws = wb.addWorksheet(name);
      ws.addRow(headers).eachCell(c => Object.assign(c, bold));
      rows.forEach(r => ws.addRow(r));
      ws.columns.forEach((col, i) => { col.width = Math.min(60, Math.max(12, ...[headers[i], ...rows.map(r => String(r[i] || ""))].map(v => String(v).length + 2))); });
      return ws;
    };
    if (fileKind === "PO") {
      add("Tong hop", ["Dòng", "OldItem", "Item", "ColorItemOld", "ColorItem điền", "RMSize điền", "MS", "Trạng thái"],
        results.map(r => [r.rowNum, r.oldItem, r.fills.Item || r.item, r.colorOld, r.fills.ColorItem || "", r.fills.RMSize || "", r.msValue || r.msRaw || "", r.status.join(" · ")]));
      add("SKU can tao", ["Item", "Màu mới", "Mã màu ứng viên", "Các dòng"], a.skuNew.map(r => [r.item, r.mauMoi, r.codes, r.rows.join(", ")]));
      add("Mau ngoai chuan hoa", ["Dòng", "OldItem", "ColorItemOld", "Ghi chú"], a.colorOut.map(r => [r.rowNum, r.oldItem, r.colorOld, r.status.join(" · ")]));
      add("Size ngoai chuan hoa", ["Dòng", "OldItem", "Size", "Ghi chú"], a.sizeOut.map(r => [r.rowNum, r.oldItem, r.sizeOld, r.status.join(" · ")]));
      add("MS can kiem tra", ["Dòng", "MS gốc", "Tình trạng", "Ứng viên"],
        a.msIssues.map(r => [r.rowNum, r.msRaw, r.msStatus === "NOTFOUND" ? "Không thấy" : "Nhiều ứng viên", r.msCandidates]));
      add("Khong map duoc Item", ["Dòng", "OldItem", "Ghi chú"], a.newCode.map(r => [r.rowNum, r.oldItem, r.status.join(" · ")]));
    } else {
      add("Tong hop", ["Dòng", "TP cũ", "Màu TP cũ", "ColorProduct điền", "OldItem", "Item điền", "Màu NPL cũ", "ColorItem điền", "RMSize điền", "Trạng thái"],
        results.map(r => [r.rowNum, r.prodOld, r.colorProdOld, r.fills.ColorProduct || "", r.oldItem, r.fills.Item || "", r.colorOld, r.fills.ColorItem || "", r.fills.RMSize || "", r.status.join(" · ")]));
      add("Mau TP ngoai chuan hoa", ["Dòng", "TP cũ", "Màu TP cũ", "Ghi chú"], a.tpOut.map(r => [r.rowNum, r.prodOld, r.colorProdOld, r.status.join(" · ")]));
      add("Da lam sach model code", ["Dòng", "TP cũ", "Màu TP cũ", "ColorProduct đã điền", "Chi tiết"],
        a.cleaned.map(r => [r.rowNum, r.prodOld, r.colorProdOld, r.fills.ColorProduct || "", r.status.join(" · ")]));
      add("Mau NPL ngoai chuan hoa", ["Dòng", "OldItem", "Màu NPL cũ", "Ghi chú"], a.colorOut.map(r => [r.rowNum, r.oldItem, r.colorOld, r.status.join(" · ")]));
      add("Size ngoai chuan hoa", ["Dòng", "Mã hàng", "Size", "Ghi chú"], a.sizeOut.map(r => [r.rowNum, r.oldItem || r.prodOld, r.sizeOld + ((r.prodSizeMissing || []).length ? " / TP: " + r.prodSizeMissing.join(",") : ""), r.status.join(" · ")]));
      add("Khong map duoc Item", ["Dòng", "OldItem", "Ghi chú"], a.newCode.map(r => [r.rowNum, r.oldItem, r.status.join(" · ")]));
    }
    saveBlob(await wb.xlsx.writeBuffer(), origName + "_bao_cao.xlsx");
  };

  /* ---------- Admin ---------- */
  function refreshAdmin() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set("srcNpl", DATA.sources.deca_npl || "—"); set("cntNpl", DATA.deca_npl ? DATA.deca_npl.length.toLocaleString() : "—");
    set("srcTp", DATA.sources.deca_tp || "—"); set("cntTp", DATA.deca_tp ? DATA.deca_tp.length.toLocaleString() : "—");
    set("srcFix", DATA.sources.deca_fix || "—"); set("cntFix", DATA.deca_fix ? DATA.deca_fix.length.toLocaleString() : "—");
    set("srcColors", DATA.sources.colors || "—"); set("cntColors", DATA.colors ? DATA.colors.length.toLocaleString() : "—");
    set("srcItems", DATA.sources.generic || "—"); set("cntItems", DATA.generic ? (DATA.generic.length.toLocaleString() + " / SKU " + DATA.sku.length.toLocaleString()) : "—");
    set("srcMs", DATA.sources.ms || "—"); set("cntMs", DATA.ms ? DATA.ms.length.toLocaleString() : "—");
  }
  let masterKind = null;
  const mi = document.getElementById("masterInput");
  window.pickMaster = function (kind) { masterKind = kind; mi.value = ""; mi.click(); };
  mi.onchange = async () => {
    if (!mi.files[0]) return;
    const st = document.getElementById("adminStatus");
    st.textContent = "Đang đọc " + mi.files[0].name + "… (file lớn có thể mất 30–60 giây)";
    await new Promise(x => setTimeout(x, 50));
    try {
      const wb = XLSX.read(await mi.files[0].arrayBuffer(), { type: "array" });
      const aoa = n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" });
      const today = new Date().toISOString().slice(0, 10);
      const cs = v => { let s = String(v == null ? "" : v).trim(); if (/^\d+\.0$/.test(s)) s = s.slice(0, -2); return s; };
      const truthy = v => ["true", "1", "yes"].includes(String(v).trim().toLowerCase()) ? 1 : 0;
      if (masterKind === "deca_npl") {
        const sheet = wb.SheetNames.includes("Mau_cu_Mau_moi") ? "Mau_cu_Mau_moi" : wb.SheetNames[0];
        const all = aoa(sheet);
        // Đọc theo TÊN CỘT (hỗ trợ cả layout cũ 11 cột lẫn layout mới có Đổi màu?/Đổi size?/Có trong Do SKU?)
        const hdr = (all[0] || []).map(h => tight(stripVN(h)));
        const col = (...names) => {
          for (const n of names) { const i = hdr.indexOf(n); if (i >= 0) return i; }
          for (const n of names) { const i = hdr.findIndex(h => h.indexOf(n) === 0); if (i >= 0) return i; }
          return -1;
        };
        const C = [col("CODESCAX"), col("CODESCAFCU"), col("CODESCAFDUNG", "CODESCAFDUNGFINAL", "CODESCAF"),
          col("MAUCU"), col("MAUMOI"), col("SIZECU"), col("SIZEMOI"), col("KIEUXULY"), col("DSM"), col("MODEL"), col("ITEM")];
        if (C.slice(0, 5).some(i => i < 0)) throw new Error("Không tìm thấy đủ cột (cần: Code ScaX, Code ScaF cũ, Code ScaF (dùng), Màu CŨ, Màu MỚI; tuỳ chọn: Size CŨ/MỚI, Kiểu xử lý, DSM, Model, Item)");
        const rows = all.slice(1).map(r => C.map(i => i >= 0 ? cs(r[i]) : "")).filter(r => r[0] || r[1] || r[2]);
        if (!rows.length) throw new Error("Không có dữ liệu chuẩn hoá NPL trong sheet «" + sheet + "»");
        await idbSet("deca_npl", { rows, date: today }); DATA.deca_npl = rows; DATA.sources.deca_npl = "Upload " + today;
      } else if (masterKind === "deca_tp") {
        const sheet = wb.SheetNames.find(n => tight(n).includes("CHUANHOA")) || wb.SheetNames[0];
        const rows = aoa(sheet).slice(1).map(r => [cs(r[0]), cs(r[1]), cs(r[2]), cs(r[3]), cs(r[4]), cs(r[5]), cs(r[6]), cs(r[7]), cs(r[8])]).filter(r => r[0]);
        if (!rows.length) throw new Error("Không có dữ liệu chuẩn hoá TP (cần cột: Code ScaF, Generic code, Mô tả, Màu CŨ, Màu MỚI, Size CŨ, Size MỚI, ColorCode, SkuCode)");
        await idbSet("deca_tp", { rows, date: today }); DATA.deca_tp = rows; DATA.sources.deca_tp = "Upload " + today;
      } else if (masterKind === "deca_fix") {
        // Gộp TẤT CẢ các sheet: cột C = Product code (F...), cột E = Model code (số)
        const rows = [];
        const seenPair = new Set();
        for (const sn of wb.SheetNames) {
          for (const r of aoa(sn)) {
            const p = cs(r[2]), m = cs(r[4]);
            if (/^F\d+$/.test(p) && /^\d{5,}$/.test(m) && !seenPair.has(p + "|" + m)) { seenPair.add(p + "|" + m); rows.push([p, m]); }
          }
        }
        if (!rows.length) throw new Error("Không có dữ liệu (cần cột C = Product code dạng F..., cột E = Model code, dữ liệu từ dòng 3, gộp mọi sheet)");
        await idbSet("deca_fix", { rows, date: today }); DATA.deca_fix = rows; DATA.sources.deca_fix = "Upload " + today;
      } else if (masterKind === "colors") {
        const sheet = wb.SheetNames.includes("PRD") ? "PRD" : wb.SheetNames[0];
        const rows = aoa(sheet).slice(1).filter(r => cs(r[0]) && cs(r[1])).map(r => [cs(r[0]), cs(r[1])]);
        if (!rows.length) throw new Error("Không có dữ liệu Code/Name");
        await idbSet("colors", { rows, date: today }); DATA.colors = rows; DATA.sources.colors = "Upload " + today;
      } else if (masterKind === "items") {
        if (!wb.SheetNames.includes("Generic") || !wb.SheetNames.includes("SKU")) throw new Error('File cần có sheet "Generic" và "SKU"');
        const g = aoa("Generic").slice(1).filter(r => cs(r[0])).map(r => [cs(r[0]), cs(r[1]), cs(r[3]), cs(r[4]), cs(r[5]), cs(r[6]), cs(r[9]), truthy(r[18]), truthy(r[19]), cs(r[34]), truthy(r[37])]);
        const s = aoa("SKU").slice(1).filter(r => cs(r[0])).map(r => [cs(r[0]), cs(r[1]), cs(r[3]), cs(r[4]), cs(r[5])]);
        await idbSet("generic", { rows: g, date: today }); await idbSet("sku", { rows: s, date: today });
        DATA.generic = g; DATA.sku = s; DATA.sources.generic = DATA.sources.sku = "Upload " + today;
      } else if (masterKind === "ms") {
        const sheet = wb.SheetNames.includes("MS ScaF") ? "MS ScaF" : wb.SheetNames[0];
        const rows = aoa(sheet).slice(1).filter(r => cs(r[0]) && cs(r[1])).map(r => [cs(r[0]), cs(r[1])]);
        if (!rows.length) throw new Error("Không có dữ liệu MS (cần sheet MS ScaF: UserName, FullName)");
        await idbSet("ms", { rows, date: today }); DATA.ms = rows; DATA.sources.ms = "Upload " + today;
      }
      buildIndexes();
      st.innerHTML = '<span class="pill ok">Đã cập nhật master «' + masterKind + '» — dữ liệu lưu trong trình duyệt này</span>';
      refreshAdmin();
    } catch (e) {
      st.innerHTML = '<span class="pill err">Lỗi: ' + e.message + "</span>";
    }
  };
  /* Xuất master hiện tại thành file .json.gz để đẩy lên repo GitHub */
  window.exportMasters = function () {
    if (!DATA.colors) { document.getElementById("adminStatus").innerHTML = '<span class="pill err">Master chưa tải xong</span>'; return; }
    for (const k of MASTER_KEYS) {
      const gz = pako.gzip(JSON.stringify(DATA[k]));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([gz], { type: "application/gzip" }));
      a.download = k + ".json.gz"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
    document.getElementById("adminStatus").innerHTML = '<span class="pill ok">Đã tải ' + MASTER_KEYS.length + ' file — upload chúng vào thư mục data/ trên GitHub (đè file cũ)</span>';
  };
  window.resetMasters = async function () {
    await idbDel(MASTER_KEYS);
    MASTER_KEYS.forEach(k => DATA[k] = null); DATA.sources = {};
    document.getElementById("adminStatus").innerHTML = '<span class="pill ok">Đã xóa bản upload — quay về dữ liệu nhúng</span>';
    await loadMasters();
  };

  /* ---------- Tabs ---------- */
  window.showTab = function (t) {
    document.getElementById("paneProcess").classList.toggle("hidden", t !== "process");
    document.getElementById("paneAdmin").classList.toggle("hidden", t !== "admin");
    document.getElementById("tabProcess").classList.toggle("active", t === "process");
    document.getElementById("tabAdmin").classList.toggle("active", t === "admin");
  };

  loadMasters();
}

/* Cho phép test bằng Node.js */
if (typeof module !== "undefined") {
  module.exports = {
    norm, tight, stripVN, cleanCode, extractNums, leadNum, DATA, IDX, buildIndexes,
    matchNPL, matchTP, matchColorRows, resolveSize, mapItem, matchMS, itemManagesColor,
    findColorCandidates, skuCheck, processPORow, processBOMRow, cleanModelFromColor, stripLeadNum
  };
}

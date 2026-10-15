// Hũ tiền: kỳ lương, phân bổ, theo dõi tốc độ chi & cảnh báo
import { db, tx, batch, getSettings } from '../db.js';
import { getPeriod, today, daysBetween, round, fmtVND } from '../utils.js';
import { HttpError, ownedId } from './finance.js';

export async function listJars({ includeArchived = false } = {}) {
  return db
    .prepare(`SELECT * FROM jars WHERE user_id = @uid ${includeArchived ? '' : 'AND archived = 0'} ORDER BY sort_order, id`)
    .all();
}

export async function findPeriodByDate(iso) {
  return db.prepare('SELECT * FROM jar_periods WHERE user_id = @uid AND ? BETWEEN start_date AND end_date ORDER BY start_date DESC').get(iso);
}

/** Kỳ hiện tại (đã tạo hoặc "ảo" nếu chưa chia lương) */
export async function currentPeriodRange(iso = today()) {
  const p = await findPeriodByDate(iso);
  if (p) return { start: p.start_date, end: p.end_date, period: p };
  const r = getPeriod(iso, (await getSettings()).salary_day);
  return { ...r, period: null };
}

/** Thu nhập phát sinh trong kỳ (gợi ý số tiền để chia) */
export async function incomeInRange(start, end) {
  return (await db
    .prepare("SELECT COALESCE(SUM(amount_base),0) s FROM transactions WHERE user_id = @uid AND type='income' AND date BETWEEN ? AND ?")
    .get(start, end)).s;
}

/**
 * Tạo / cập nhật kỳ chia hũ.
 * body: { date?, start_date?, income_amount, allocations?: [{jar_id, percent?, amount?}] }
 */
export const upsertPeriod = tx(async (body) => {
  const salaryDay = (await getSettings()).salary_day;
  const range = getPeriod(body.start_date || body.date || today(), salaryDay);
  const start = body.start_date || range.start;
  const end = body.end_date || range.end;
  const income = Number(body.income_amount);
  if (!(income > 0)) throw new HttpError(400, 'Số tiền chia hũ phải > 0');

  let period = await db.prepare('SELECT * FROM jar_periods WHERE user_id = @uid AND start_date = ?').get(start);
  if (period) {
    await db.prepare('UPDATE jar_periods SET income_amount = ?, end_date = ?, note = ? WHERE user_id = @uid AND id = ?').run(
      income,
      end,
      body.note ?? period.note,
      period.id
    );
  } else {
    const { lastInsertRowid: id } = await db
      .prepare('INSERT INTO jar_periods(user_id, start_date, end_date, income_amount, note) VALUES (@uid,?,?,?,?)')
      .run(start, end, income, body.note || null);
    period = { id };
  }
  await setAllocations(period.id, income, body.allocations);
  return periodStatus(period.id);
});

/** Số tiền mỗi hũ nhận theo cấu hình: hũ cố định nhận đủ trước, phần còn lại chia theo % */
export function splitByConfig(jars, income) {
  const fixedTotal = jars.reduce((s, j) => s + (j.fixed_amount > 0 ? j.fixed_amount : 0), 0);
  const rest = Math.max(0, income - fixedTotal);
  return { fixedTotal, amounts: new Map(jars.map((j) => [j.id, j.fixed_amount > 0 ? j.fixed_amount : (rest * j.percent) / 100])) };
}

/** Ghi phân bổ cho kỳ. Không truyền allocations -> dùng cấu hình mặc định của từng hũ */
export async function setAllocations(periodId, income, allocations) {
  const jars = await listJars();
  const byJar = new Map((allocations || []).map((a) => [Number(a.jar_id), a]));
  const UP = `INSERT INTO jar_allocations(user_id, period_id, jar_id, percent, amount) VALUES (@uid,?,?,?,?)
     ON CONFLICT(period_id, jar_id) DO UPDATE SET percent = excluded.percent, amount = excluded.amount`;
  const stmts = [['DELETE FROM jar_allocations WHERE user_id = @uid AND period_id = ?', [periodId]]];
  const { fixedTotal, amounts } = splitByConfig(jars, income);
  if (!allocations?.length && fixedTotal > income)
    throw new HttpError(400, `Tổng các hũ cố định (${fmtVND(fixedTotal)}) lớn hơn số tiền chia (${fmtVND(income)})`);
  for (const j of jars) {
    const a = byJar.get(j.id);
    let amount = amounts.get(j.id);
    let percent = income > 0 ? (amount / income) * 100 : 0;
    if (a) {
      if (a.amount != null && a.amount !== '') {
        amount = Number(a.amount);
        percent = income > 0 ? (amount / income) * 100 : 0;
      } else if (a.percent != null) {
        percent = Number(a.percent);
        amount = (income * percent) / 100;
      }
    }
    stmts.push([UP, [periodId, j.id, round(percent, 2), round(amount)]]);
  }
  await batch(stmts);
}

export const updateAllocations = tx(async (periodId, { income_amount, allocations }) => {
  const p = await db.prepare('SELECT * FROM jar_periods WHERE user_id = @uid AND id = ?').get(Number(periodId) || 0);
  if (!p) throw new HttpError(404, 'Không tìm thấy kỳ');
  const income = income_amount != null ? Number(income_amount) : p.income_amount;
  await db.prepare('UPDATE jar_periods SET income_amount = ? WHERE user_id = @uid AND id = ?').run(income, p.id);
  await setAllocations(p.id, income, allocations);
  return periodStatus(p.id);
});

export async function transferBetweenJars(periodId, { from_jar_id, to_jar_id, amount, note }) {
  if (Number(from_jar_id) === Number(to_jar_id)) throw new HttpError(400, 'Hai hũ phải khác nhau');
  if (!(Number(amount) > 0)) throw new HttpError(400, 'Số tiền phải > 0');
  const period = await ownedId('jar_periods', periodId);
  const from = await ownedId('jars', from_jar_id);
  const to = await ownedId('jars', to_jar_id);
  if (!period || !from || !to) throw new HttpError(400, 'Thiếu kỳ hoặc hũ');
  await db.prepare('INSERT INTO jar_transfers(user_id, period_id, from_jar_id, to_jar_id, amount, note) VALUES (@uid,?,?,?,?,?)').run(
    period,
    from,
    to,
    Number(amount),
    note || null
  );
  return periodStatus(periodId);
}

/**
 * Tình trạng từng hũ trong kỳ + cảnh báo.
 * Logic cảnh báo: so % đã chi của hũ với % thời gian đã trôi qua trong kỳ.
 */
export async function periodStatus(periodId, onDate = today()) {
  const p = await db.prepare('SELECT * FROM jar_periods WHERE user_id = @uid AND id = ?').get(Number(periodId) || 0);
  if (!p) throw new HttpError(404, 'Không tìm thấy kỳ');
  const { overspend_tolerance: tol } = await getSettings();

  const totalDays = daysBetween(p.start_date, p.end_date) + 1;
  const ref = onDate < p.start_date ? p.start_date : onDate > p.end_date ? p.end_date : onDate;
  const elapsedDays = Math.max(1, daysBetween(p.start_date, ref) + 1);
  // số ngày còn lại để chi (tính cả hôm nay)
  const daysLeft = onDate > p.end_date ? 0 : Math.max(0, totalDays - elapsedDays + 1);
  const timeRatio = elapsedDays / totalDays;

  const [allocs, spentRows, trs] = await Promise.all([
    db.prepare(
      `SELECT j.*, COALESCE(a.amount,0) allocated, COALESCE(a.percent,0) alloc_percent
       FROM jars j LEFT JOIN jar_allocations a ON a.jar_id = j.id AND a.period_id = ? AND a.user_id = @uid
       WHERE j.user_id = @uid AND j.archived = 0 ORDER BY j.sort_order, j.id`
    ).all(p.id),
    db.prepare(
      `SELECT jar_id, SUM(amount_base) s FROM transactions
       WHERE user_id = @uid AND type='expense' AND date BETWEEN ? AND ? GROUP BY jar_id`
    ).all(p.start_date, ref),
    db.prepare('SELECT * FROM jar_transfers WHERE user_id = @uid AND period_id = ?').all(p.id),
  ]);
  const spentBy = new Map(spentRows.map((r) => [r.jar_id, r.s]));

  const jars = allocs.map((j) => {
    const tin = trs.filter((t) => t.to_jar_id === j.id).reduce((s, t) => s + t.amount, 0);
    const tout = trs.filter((t) => t.from_jar_id === j.id).reduce((s, t) => s + t.amount, 0);
    const budget = j.allocated + tin - tout;
    const spent = spentBy.get(j.id) || 0;
    const remaining = budget - spent;
    const spentRatio = budget > 0 ? spent / budget : spent > 0 ? Infinity : 0;
    const projected = spent / timeRatio; // chi tiêu dự kiến cả kỳ nếu giữ tốc độ hiện tại
    let status = 'ok';
    if (!j.is_saving) {
      if (spent > budget && spent > 0) status = 'over';
      else if (spentRatio >= timeRatio + 2.5 * tol || (spentRatio > 0.3 && spentRatio >= timeRatio * 1.5)) status = 'danger';
      else if (spentRatio > timeRatio + tol) status = 'warning';
    }
    return {
      jar_id: j.id,
      name: j.name,
      code: j.code,
      color: j.color,
      icon: j.icon,
      is_saving: !!j.is_saving,
      percent: j.alloc_percent,
      allocated: round(j.allocated),
      transfer_in: round(tin),
      transfer_out: round(tout),
      budget: round(budget),
      spent: round(spent),
      remaining: round(remaining),
      spent_percent: budget > 0 ? round(spentRatio * 100, 1) : spent > 0 ? 999 : 0,
      projected: round(projected),
      daily_allowance: daysLeft > 0 ? round(Math.max(0, remaining) / daysLeft) : 0,
      planned_daily: round(budget / totalDays),
      status,
    };
  });

  const unassigned = spentBy.get(null) || 0;
  const alerts = buildAlerts(jars, { timeRatio, daysLeft, totalDays });
  if (unassigned > 0)
    alerts.push({
      level: 'info',
      jar_id: null,
      message: `Có ${fmtVND(unassigned)} chi tiêu chưa gắn hũ. Hãy gán hũ cho danh mục để theo dõi chính xác.`,
    });

  const totals = jars.reduce(
    (s, j) => ({ budget: s.budget + j.budget, spent: s.spent + j.spent }),
    { budget: 0, spent: unassigned }
  );

  return {
    period: p,
    total_days: totalDays,
    elapsed_days: elapsedDays,
    days_left: daysLeft,
    time_percent: round(timeRatio * 100, 1),
    income: p.income_amount,
    // phần tiền chưa chia vào hũ nào (khi tổng % < 100)
    unallocated: round(Math.max(0, p.income_amount - jars.reduce((s, j) => s + j.allocated, 0))),
    total_budget: round(totals.budget),
    total_spent: round(totals.spent),
    unassigned_spent: round(unassigned),
    jars,
    transfers: trs,
    alerts,
  };
}

/**
 * Cảnh báo + gợi ý.
 * "Cần bù" = số tiền để hũ quay lại mức chi theo kế hoạch cho những ngày còn lại
 *   = ngân_sách/ngày × số ngày còn lại − số còn lại   (không ngoại suy 1 khoản chi lớn ra cả kỳ)
 * Hũ cho mượn: hũ chi tiêu đang ổn, được phép cắt tối đa 20% phần kế hoạch còn lại; ưu tiên hũ không phải Thiết yếu.
 */
function buildAlerts(jars, { timeRatio, daysLeft }) {
  const alerts = [];
  const pct = (x) => `${Math.round(x * 100)}%`;
  const round10k = (x) => Math.ceil(x / 10000) * 10000;
  const donorsBase = jars
    .filter((j) => !j.is_saving && j.status === 'ok' && j.budget > 0)
    .map((j) => ({ ...j, surplus: Math.max(0, j.remaining - j.planned_daily * daysLeft * 0.8) }))
    .filter((j) => j.surplus >= 10000);

  for (const j of jars) {
    if (j.status === 'ok') continue;
    const need = Math.max(0, j.planned_daily * daysLeft - j.remaining);
    const donor = donorsBase
      .filter((d) => d.jar_id !== j.jar_id)
      .sort((a, b) => (a.code === 'NEC') - (b.code === 'NEC') || b.surplus - a.surplus)[0];
    const suggestion = {};
    let msg;
    if (j.status === 'over') {
      msg = `Hũ ${j.name} đã VƯỢT ngân sách ${fmtVND(j.spent - j.budget)} (chi ${fmtVND(j.spent)}/${fmtVND(j.budget)}).`;
    } else {
      msg = `Hũ ${j.name} đã chi ${pct(j.spent / j.budget)} ngân sách trong khi mới qua ${pct(timeRatio)} kỳ.`;
      if (daysLeft > 0)
        msg += ` Còn ${fmtVND(j.remaining)} cho ${daysLeft} ngày ≈ ${fmtVND(j.daily_allowance)}/ngày (kế hoạch ${fmtVND(j.planned_daily)}/ngày).`;
    }
    if (donor && need > 0) {
      const amt = round10k(Math.min(need, donor.surplus));
      suggestion.from_jar_id = donor.jar_id;
      suggestion.from_jar_name = donor.name;
      suggestion.amount = amt;
      msg += amt >= need
        ? ` Có thể chuyển ${fmtVND(amt)} từ hũ ${donor.name} sang để chi bình thường, hoặc tiết kiệm hơn.`
        : ` Có thể chuyển ${fmtVND(amt)} từ hũ ${donor.name}, phần còn lại (~${fmtVND(Math.round((need - amt) / 10000) * 10000)}) cần chi tiết kiệm hơn.`;
    } else if (need > 0) {
      msg += ` Các hũ khác không còn dư — cần giảm chi khoảng ${fmtVND(round10k(need))} trong kỳ này.`;
    }
    alerts.push({ level: j.status === 'warning' ? 'warning' : 'danger', jar_id: j.jar_id, message: msg, suggestion });
  }
  return alerts;
}

/** Trạng thái kỳ hiện tại (null nếu chưa chia lương kỳ này) */
export async function currentStatus(iso = today()) {
  const p = await findPeriodByDate(iso);
  return p ? periodStatus(p.id, iso) : null;
}

/** Chi tiêu trung bình mỗi kỳ theo hũ (dựa trên N kỳ gần nhất, hoặc 90 ngày gần nhất) */
export async function averageSpendByJar(iso = today()) {
  const past = await db
    .prepare('SELECT * FROM jar_periods WHERE user_id = @uid AND end_date < ? ORDER BY start_date DESC LIMIT 3')
    .all(iso);
  let from, months;
  if (past.length) {
    from = past[past.length - 1].start_date;
    months = past.length;
  } else {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    from = d.toISOString().slice(0, 10);
    months = 3;
  }
  const to = past.length ? past[0].end_date : iso;
  const [rows, first] = await Promise.all([
    db.prepare(
      `SELECT jar_id, SUM(amount_base) s FROM transactions
       WHERE user_id = @uid AND type='expense' AND date BETWEEN ? AND ? GROUP BY jar_id`
    ).all(from, to),
    db.prepare("SELECT MIN(date) d FROM transactions WHERE user_id = @uid AND type='expense'").get(),
  ]);
  const firstTx = first.d;
  if (firstTx && firstTx > from) months = Math.max(1, daysBetween(firstTx, to) / 30.4);
  return Object.fromEntries(rows.map((r) => [r.jar_id ?? 'none', round(r.s / months)]));
}

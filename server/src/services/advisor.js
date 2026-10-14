// Gợi ý chia hũ: tính toán theo quy tắc, AI (nếu có) diễn giải & tinh chỉnh
import { db } from '../db.js';
import { normalize, AMOUNT_RE, parseAmountMatch, today, round, fmtVND, daysBetween, addDays, getPeriod } from '../utils.js';
import { getSettings } from '../db.js';
import { listJars, findPeriodByDate, periodStatus, currentPeriodRange, incomeInRange, averageSpendByJar } from './jars.js';
import { listGoals } from './finance.js';
import { aiEnabled, complete, extractJson } from './ai.js';

const roundUp = (n, step = 10000) => Math.ceil(n / step) * step;
const roundDown = (n, step = 10000) => Math.floor(n / step) * step;

/** Đọc mục tiêu trong câu hỏi: "tiết kiệm 5tr để mua khoá học trong 2 tháng", "lương 18tr" */
export function readRequest(message) {
  const n = normalize(message);
  const amounts = [...n.matchAll(new RegExp(AMOUNT_RE.source, 'gi'))].map((m) => ({
    value: parseAmountMatch(m),
    index: m.index,
    unit: m[2],
  }));
  let income = null;
  const li = n.search(/\b(luong|thu nhap)\b/);
  if (li >= 0) {
    const a = amounts.find((x) => x.index > li && x.index - li < 25 && (x.unit || x.value >= 10000));
    if (a) income = a.value;
  }
  const monthsM = n.match(/(\d+)\s*thang/);
  const months = monthsM ? Math.max(1, Number(monthsM[1])) : 1;
  const target = amounts.find((a) => a.value !== income && a.value >= 1000 && (a.unit || a.value >= 10000));
  const purposeM = message.match(/(?:để|đê|de)\s+([^,.?!]+)/i);
  const isEdu = /(khoa hoc|hoc|sach|ielts|toeic|dao tao)/.test(n);
  return {
    target: target?.value || 0,
    months,
    income,
    purpose: purposeM ? purposeM[1].trim() : null,
    jarCode: isEdu ? 'EDU' : 'LTSS',
  };
}

/** Bối cảnh tài chính hiện tại cho tư vấn. Kỳ sắp hết (<= 3 ngày) -> tư vấn cho kỳ kế tiếp */
export async function buildContext(onDate = today()) {
  const [jars, settings, range0, p0] = await Promise.all([
    listJars(), getSettings(), currentPeriodRange(onDate), findPeriodByDate(onDate),
  ]);
  const salaryDay = settings.salary_day;
  let range = range0;
  let p = p0;
  let nextPeriod = false;
  if (daysBetween(onDate, range.end) + 1 <= 3) {
    nextPeriod = true;
    const nx = getPeriod(addDays(range.end, 1), salaryDay);
    p = await findPeriodByDate(nx.start);
    range = { start: nx.start, end: nx.end };
  }
  const ref = nextPeriod ? range.start : onDate;
  const status = p ? await periodStatus(p.id, ref) : null;
  const totalDays = daysBetween(range.start, range.end) + 1;
  const daysLeft = nextPeriod ? totalDays : Math.max(1, daysBetween(onDate, range.end) + 1);
  const [avg, goals, lastPeriod, avgIncomeRow, contribRows, incomeNow] = await Promise.all([
    averageSpendByJar(onDate),
    listGoals({ status: 'active' }),
    db.prepare('SELECT income_amount FROM jar_periods WHERE user_id = @uid AND start_date < ? ORDER BY start_date DESC LIMIT 1').get(range.start),
    db.prepare(
      "SELECT COALESCE(SUM(amount_base),0)/3.0 s FROM transactions WHERE user_id = @uid AND type='income' AND date >= date(?, '-90 day') AND date < ?"
    ).get(range.start, range.start),
    db.prepare('SELECT goal_id, SUM(amount) s FROM savings_contributions WHERE user_id = @uid AND date BETWEEN ? AND ? GROUP BY goal_id')
      .all(range.start, range.end),
    incomeInRange(range.start, range.end),
  ]);
  const avgIncome = avgIncomeRow.s;
  const contributedBy = new Map(contribRows.map((r) => [r.goal_id, r.s]));
  return {
    date: onDate,
    next_period: nextPeriod,
    period: { start: range.start, end: range.end, total_days: totalDays, days_left: daysLeft, created: !!p },
    income: status?.income || incomeNow || lastPeriod?.income_amount || round(avgIncome),
    jars: jars.map((j) => {
      const s = status?.jars.find((x) => x.jar_id === j.id);
      return {
        jar_id: j.id,
        name: j.name,
        code: j.code,
        default_percent: j.percent,
        is_saving: !!j.is_saving,
        budget: s?.budget ?? null,
        spent: s?.spent ?? 0,
        avg_monthly_spend: avg[j.id] || 0,
      };
    }),
    unassigned_spent: status?.unassigned_spent || 0,
    goals: goals.map((g) => ({
      id: g.id,
      name: g.name,
      target: g.target_amount,
      saved: g.saved,
      months_left: g.months_left,
      required_monthly: g.required_monthly,
      contributed_this_period: round(contributedBy.get(g.id) || 0),
      jar_id: g.jar_id,
    })),
  };
}

/** Tính phân bổ phần tiền còn lại của kỳ theo quy tắc */
export function ruleAdvice(message, ctx) {
  const req = readRequest(message);
  const income = req.income || ctx.income;
  const spentTotal = ctx.jars.reduce((s, j) => s + j.spent, 0) + ctx.unassigned_spent;
  const available = Math.max(0, income - spentTotal);
  const rf = ctx.period.days_left / ctx.period.total_days; // tỷ lệ kỳ còn lại
  const lines = [];
  const alloc = new Map(ctx.jars.map((j) => [j.jar_id, 0]));
  const byCode = (c) => ctx.jars.find((j) => j.code === c);

  if (!income) {
    return {
      ok: false,
      text: 'Chưa có dữ liệu thu nhập kỳ này. Hãy nhập lương (VD: "Thu 15tr Lương BIDV") hoặc ghi rõ "lương tháng này 15tr" trong câu hỏi.',
      request: req,
    };
  }

  // 1. Khoản tiết kiệm bắt buộc: mục tiêu trong câu hỏi + mục tiêu đang chạy
  const mustSave = [];
  if (req.target) {
    const per = roundUp(req.target / req.months);
    const jar = byCode(req.jarCode) || ctx.jars.find((j) => j.is_saving) || ctx.jars[0];
    mustSave.push({ label: req.purpose || 'mục tiêu mới', amount: per, jar_id: jar.jar_id });
  }
  for (const g of ctx.goals) {
    const need = g.required_monthly - g.contributed_this_period;
    if (need <= 0) continue;
    const jar = ctx.jars.find((j) => j.jar_id === g.jar_id) || byCode('LTSS') || ctx.jars.find((j) => j.is_saving);
    mustSave.push({ label: `mục tiêu "${g.name}"`, amount: roundUp(need), jar_id: jar?.jar_id });
  }
  const saveTotal = mustSave.reduce((s, x) => s + x.amount, 0);

  // 2. Chi tiêu thiết yếu dự kiến cho phần còn lại của kỳ
  const nec = byCode('NEC') || ctx.jars.find((j) => !j.is_saving);
  // Không ngoại suy khoản chi lớn đầu kỳ (VD tiền nhà) ra cả kỳ:
  //  - theo lịch sử: phần còn thiếu so với mức chi bình quân/kỳ (tối thiểu 1/2 mức bình quân cho số ngày còn lại)
  //  - theo tốc độ đang chi: chỉ dùng khi đã qua >= 30% kỳ, và không vượt 1,5 lần mức lịch sử
  const elapsed = 1 - rf;
  const remainOf = (full) => Math.max(full - nec.spent, full * rf * 0.5);
  const hist = nec.avg_monthly_spend > 0 ? remainOf(nec.avg_monthly_spend) : 0;
  const pace = nec.spent > 0 && elapsed >= 0.3 ? (nec.spent / elapsed) * rf : 0;
  const defaultNeed = remainOf((income * nec.default_percent) / 100);
  const necNeed = roundUp(hist ? Math.max(hist, Math.min(pace, hist * 1.5)) : pace || defaultNeed);

  let rest = available - saveTotal - necNeed;
  lines.push(`${ctx.next_period ? '📅 Kỳ hiện tại sắp kết thúc nên tính cho kỳ lương tới. ' : ''}Thu nhập kỳ ${ctx.period.start} → ${ctx.period.end}: **${fmtVND(income)}**, đã chi ${fmtVND(spentTotal)}, còn **${fmtVND(available)}** cho ${ctx.period.days_left} ngày.`);
  for (const s of mustSave) lines.push(`• Để riêng ${fmtVND(s.amount)} cho ${s.label}${req.months > 1 && s.label === (req.purpose || 'mục tiêu mới') ? ` (${fmtVND(req.target)} / ${req.months} tháng)` : ''}.`);
  lines.push(`• Chi tiêu thiết yếu dự kiến phần còn lại: ${fmtVND(necNeed)} (≈ ${fmtVND(necNeed / ctx.period.days_left)}/ngày).`);

  let feasible = true;
  if (rest < 0) {
    feasible = false;
    // cắt thiết yếu tối đa 15%, nếu vẫn thiếu -> giảm tiết kiệm & đề xuất giãn thời gian
    const cut = Math.min(-rest, necNeed * 0.15);
    const necFinal = roundDown(necNeed - cut);
    alloc.set(nec.jar_id, necFinal);
    let canSave = Math.max(0, available - necFinal);
    lines.push(`⚠️ Không đủ tiền: thiếu ${fmtVND(-rest)}. Cần giảm chi thiết yếu xuống ${fmtVND(necFinal)} và tạm dừng các hũ Hưởng thụ/Cho đi.`);
    for (const s of mustSave) {
      const a = Math.min(s.amount, canSave);
      alloc.set(s.jar_id, alloc.get(s.jar_id) + a);
      canSave -= a;
    }
    if (req.target) {
      // Năng lực tiết kiệm mỗi tháng = thu nhập - thiết yếu bình quân - các mục tiêu đang chạy
      const necMonthly = nec.avg_monthly_spend || (income * nec.default_percent) / 100;
      const otherGoals = mustSave.slice(1).reduce((s, x) => s + x.amount, 0);
      const capacity = income - necMonthly - otherGoals;
      if (capacity > 0) {
        const monthsNeeded = Math.ceil(req.target / (capacity * 0.8));
        if (monthsNeeded <= req.months) lines.push(`👉 Chỉ thiếu ${fmtVND(-rest)}: có thể bớt chi tiêu kỳ này hoặc tạm giảm phần để dành cho mục tiêu dài hạn.`);
        else lines.push(`👉 Với thu nhập hiện tại, nên giãn mục tiêu ${fmtVND(req.target)} ra khoảng **${monthsNeeded} tháng** (≈ ${fmtVND(roundUp(req.target / monthsNeeded))}/tháng).`);
      } else {
        lines.push('👉 Thu nhập hiện tại chưa đủ để vừa chi thiết yếu vừa nuôi các mục tiêu đang chạy. Cân nhắc giãn hạn hoặc tạm dừng bớt mục tiêu.');
      }
    }
    rest = Math.max(0, canSave);
    if (rest > 0) alloc.set(nec.jar_id, alloc.get(nec.jar_id) + rest);
  } else {
    alloc.set(nec.jar_id, necNeed);
    for (const s of mustSave) alloc.set(s.jar_id, alloc.get(s.jar_id) + s.amount);
    // 3. Phần dư chia cho các hũ còn lại theo % mặc định
    const others = ctx.jars.filter((j) => j.jar_id !== nec.jar_id);
    const w = others.reduce((s, j) => s + j.default_percent, 0) || 1;
    let used = 0;
    others.forEach((j, i) => {
      const a = i === others.length - 1 ? rest - used : roundDown((rest * j.default_percent) / w);
      used += a;
      alloc.set(j.jar_id, alloc.get(j.jar_id) + a);
    });
    lines.push(`• Còn dư ${fmtVND(rest)} → chia cho các hũ khác theo tỷ lệ mặc định.`);
    if (rest < income * 0.05)
      lines.push(`⚠️ Gần như không còn tiền cho Hưởng thụ/Cho đi (chỉ ${fmtVND(rest)}). Nên giãn bớt thời hạn một mục tiêu để chi tiêu thoải mái hơn.`);
  }

  const allocations = ctx.jars.map((j) => {
    const remaining = round(alloc.get(j.jar_id) || 0);
    const total = round(j.spent + remaining);
    return {
      jar_id: j.jar_id,
      name: j.name,
      spent: j.spent,
      remaining_amount: remaining,
      amount: total,
      percent: round((total / income) * 100, 1),
    };
  });

  return { ok: true, feasible, income, available, text: lines.join('\n'), allocations, request: req, period: ctx.period, context: ctx };
}

/** Gợi ý cuối cùng: AI diễn giải dựa trên con số đã tính (AI không có -> trả về rule-based) */
export async function advise(message, history = []) {
  const ctx = await buildContext();
  const base = ruleAdvice(message, ctx);
  if (!base.ok || !aiEnabled()) return { ...base, source: 'rules' };
  try {
    const system = `Bạn là chuyên gia tài chính cá nhân, trả lời tiếng Việt, ngắn gọn, thực tế, dùng gạch đầu dòng.
Người dùng chia lương theo phương pháp 6 hũ, kỳ lương bắt đầu từ ngày lương.
Dưới đây là DỮ LIỆU THẬT và PHƯƠNG ÁN đã tính bằng quy tắc. Hãy đánh giá, có thể tinh chỉnh số tiền
"remaining_amount" (phần tiền CÒN LẠI đưa vào mỗi hũ) nhưng TỔNG phải bằng đúng available = ${base.available}.
Trả lời gồm: phần giải thích (markdown, tối đa 10 dòng) rồi một khối \`\`\`json {"allocations":[{"jar_id":..,"remaining_amount":..}]}\`\`\`.`;
    const payload = { context: ctx, rule_plan: base.allocations, rule_notes: base.text, request: base.request };
    const text = await complete({
      system,
      messages: [...history.slice(-4), { role: 'user', content: `${message}\n\nDỮ LIỆU:\n${JSON.stringify(payload)}` }],
      max_tokens: 1500,
    });
    const j = extractJson(text);
    let allocations = base.allocations;
    if (j?.allocations?.length) {
      const sum = j.allocations.reduce((s, a) => s + Number(a.remaining_amount || 0), 0);
      if (Math.abs(sum - base.available) <= Math.max(1000, base.available * 0.01)) {
        allocations = base.allocations.map((a) => {
          const x = j.allocations.find((y) => Number(y.jar_id) === a.jar_id);
          const remaining = x ? round(Number(x.remaining_amount)) : a.remaining_amount;
          const total = a.spent + remaining;
          return { ...a, remaining_amount: remaining, amount: total, percent: round((total / base.income) * 100, 1) };
        });
      }
    }
    const explanation = text.replace(/```[\s\S]*?```/g, '').trim();
    return { ...base, text: explanation || base.text, rule_text: base.text, allocations, source: 'ai' };
  } catch (e) {
    return { ...base, source: 'rules', ai_error: e.message };
  }
}

import { DEFAULT_RULES, formatNaira, parseDrawNumber, type GameRules } from '@daily-draw/shared';

/**
 * USSD menu as a pure function (design: "User experience flows").
 * Africa's Talking sends the whole path so far, e.g. "1*1*42*2", and expects a reply
 * starting "CON " (show and wait) or "END " (show and close). Keep every screen short:
 * telcos cut off around 182 characters.
 *
 * Purchases are not made here: R1 will call the API, which owns all money logic.
 */
export interface UssdContext {
  rules: GameRules;
  /** Tonight's pool so far, already formatted, e.g. "₦612,400". */
  poolLabel: string;
  /** Last result line, e.g. "Last number: 42. 31 winners, ₦27,419 each." */
  lastResult: string;
}

export interface UssdReply {
  type: 'CON' | 'END';
  message: string;
}

export const MAX_SCREEN_CHARS = 182;

const con = (message: string): UssdReply => ({ type: 'CON', message });
const end = (message: string): UssdReply => ({ type: 'END', message });
const invalid = end('Invalid choice. Please dial again.');

function ticketCount(input: string, rules: GameRules): number | null {
  if (!/^\d{1,2}$/.test(input)) return null;
  const n = Number(input);
  return n >= 1 && n <= rules.maxTicketsPerPlayerPerDay ? n : null;
}

function confirmScreen(label: string, count: number, rules: GameRules): UssdReply {
  const total = formatNaira(rules.ticketPriceKobo * BigInt(count));
  return con(
    `Confirm: ${count} ticket${count === 1 ? '' : 's'} on ${label} for ${total}\n1 Confirm\n2 Cancel`,
  );
}

export function handleUssd(text: string, ctx: UssdContext): UssdReply {
  const { rules } = ctx;
  const path = text === '' ? [] : text.split('*');
  const [first, second, third, fourth, fifth] = path;
  const digits = rules.numberRange === 100 ? '00-99' : '000-999';
  const price = formatNaira(rules.ticketPriceKobo);

  if (path.length === 0) {
    return con(
      `Daily Draw - Pool ${ctx.poolLabel}, closes ${rules.cutoffTime}\n1 Play today (${price})\n2 Results\n3 Wallet\n4 Limits and help\n0 Language`,
    );
  }

  switch (first) {
    case '1': {
      if (second === undefined) return con('1 Pick my number\n2 Lucky dip\n3 My favourites');
      if (second === '1') {
        if (third === undefined) return con(`Enter your number (${digits}):`);
        let label: string;
        try {
          parseDrawNumber(third, rules.numberRange);
          label = third;
        } catch {
          return end(`Numbers must be ${digits}. Please dial again.`);
        }
        if (fourth === undefined)
          return con(`How many tickets on ${label}? (1-${rules.maxTicketsPerPlayerPerDay})`);
        const count = ticketCount(fourth, rules);
        if (count === null) return invalid;
        if (fifth === undefined) return confirmScreen(label, count, rules);
        if (fifth === '1')
          return end(
            `Done! ${count} ticket${count === 1 ? '' : 's'} on ${label} for tonight's ${rules.drawTime} draw. SMS receipt coming.`,
          );
        if (fifth === '2') return end('Cancelled. Nothing was charged.');
        return invalid;
      }
      if (second === '2') {
        if (third === undefined)
          return con(`How many lucky dip tickets? (1-${rules.maxTicketsPerPlayerPerDay})`);
        const count = ticketCount(third, rules);
        if (count === null) return invalid;
        if (fourth === undefined) return confirmScreen('lucky dip', count, rules);
        if (fourth === '1')
          return end(
            `Done! ${count} lucky dip ticket${count === 1 ? '' : 's'} for tonight. Your numbers are coming by SMS.`,
          );
        if (fourth === '2') return end('Cancelled. Nothing was charged.');
        return invalid;
      }
      if (second === '3')
        return end('No favourites saved yet. Play a number and we will offer to save it.');
      return invalid;
    }
    case '2':
      return path.length === 1 ? end(ctx.lastResult) : invalid;
    case '3':
      if (second === undefined) return con('1 Balance\n2 Add money\n3 Withdraw');
      if (second === '1') return end('Balance coming by SMS.');
      if (second === '2') return end('Your account number for transfers is coming by SMS.');
      if (second === '3') return end('Withdrawals need your PIN. This is coming soon.');
      return invalid;
    case '4':
      return path.length === 1
        ? end(
            'Set limits or take a break in the app or reply HELP by SMS. Play for fun, not for income.',
          )
        : invalid;
    case '0':
      return path.length === 1 ? end('Languages: English, Pidgin. More coming soon.') : invalid;
    default:
      return invalid;
  }
}

export const defaultContext: UssdContext = {
  rules: DEFAULT_RULES,
  poolLabel: '₦0',
  lastResult: 'No results yet. First draw coming soon.',
};

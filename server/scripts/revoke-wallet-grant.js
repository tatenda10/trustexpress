import 'dotenv/config';
import { query, withTransaction } from '../db/connection.js';

/**
 * Reverses a wallet grant issued by grant-startup-wallet-credit.js.
 *
 * Each reversal writes a matching manual_debit row so the ledger stays truthful
 * rather than deleting history. Safe to re-run: rows already reversed are skipped.
 *
 * Examples:
 *   node scripts/revoke-wallet-grant.js --grant-id=promo_2026_08
 *   node scripts/revoke-wallet-grant.js --grant-id=promo_2026_08 --apply=true
 */

function getArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`) || getArg(name).toLowerCase() === 'true';
}

function normalizeMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

async function main() {
  const grantId = String(getArg('grant-id')).trim();
  const apply = hasFlag('apply');

  if (!grantId) {
    throw new Error('--grant-id is required, e.g. --grant-id=promo_2026_08');
  }

  const reversalSourceType = 'startup_grant_reversal';

  const credits = await query(
    `SELECT id, driver_user_id, amount, currency, created_at
     FROM driver_wallet_transactions
     WHERE transaction_type = 'manual_credit'
       AND source_type = 'startup_grant'
       AND source_id = ?
     ORDER BY id`,
    [grantId]
  );

  const reversals = await query(
    `SELECT source_id
     FROM driver_wallet_transactions
     WHERE transaction_type = 'manual_debit'
       AND source_type = ?`,
    [reversalSourceType]
  );
  const reversedCreditIds = new Set(reversals.map((row) => String(row.source_id)));

  const pending = credits.filter((row) => !reversedCreditIds.has(String(row.id)));
  const totalToReverse = pending.reduce((sum, row) => sum + normalizeMoney(row.amount), 0);

  console.log(`\nRevoke wallet grant "${grantId}"`);
  console.log(`  mode:              ${apply ? 'APPLY (will debit wallets)' : 'DRY RUN (no writes)'}`);
  console.log(`  credits found:     ${credits.length}`);
  console.log(`  already reversed:  ${credits.length - pending.length}`);
  console.log(`  pending reversal:  ${pending.length}`);
  console.log(`  total to reverse:  ${normalizeMoney(totalToReverse).toFixed(2)}\n`);

  if (pending.length === 0) {
    console.log('Nothing to reverse.');
    return;
  }

  const summary = { reversed: 0, skipped: 0, failed: 0 };

  for (const credit of pending) {
    const creditAmount = normalizeMoney(credit.amount);
    try {
      if (!apply) {
        console.log(`[dry-run] would debit ${credit.currency} ${creditAmount.toFixed(2)} from ${credit.driver_user_id}`);
        summary.reversed += 1;
        continue;
      }

      const result = await withTransaction(async (connection) => {
        const [walletRows] = await connection.execute(
          `SELECT available_balance
           FROM driver_wallets
           WHERE driver_user_id = ?
           LIMIT 1
           FOR UPDATE`,
          [credit.driver_user_id]
        );
        if (!walletRows[0]) return { skipped: true, reason: 'no wallet row' };

        const balanceBefore = normalizeMoney(walletRows[0].available_balance);
        // Never push a driver negative if they have already spent the credit.
        const debitAmount = Math.min(creditAmount, balanceBefore);
        if (!(debitAmount > 0)) return { skipped: true, reason: 'balance already zero' };

        const balanceAfter = normalizeMoney(balanceBefore - debitAmount);

        await connection.execute(
          `UPDATE driver_wallets
           SET available_balance = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE driver_user_id = ?`,
          [balanceAfter, credit.driver_user_id]
        );

        await connection.execute(
          `INSERT INTO driver_wallet_transactions (
             driver_user_id,
             transaction_type,
             amount,
             currency,
             payment_method,
             source_type,
             source_id,
             balance_before,
             balance_after,
             provider_reference,
             external_transaction_id,
             description
           ) VALUES (?, 'manual_debit', ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, ?)`,
          [
            credit.driver_user_id,
            debitAmount,
            credit.currency,
            reversalSourceType,
            String(credit.id),
            balanceBefore,
            balanceAfter,
            `Reversal of grant ${grantId}`,
          ]
        );

        return { skipped: false, debitAmount, balanceBefore, balanceAfter };
      });

      if (result.skipped) {
        summary.skipped += 1;
        console.log(`[skip] ${credit.driver_user_id}: ${result.reason}`);
        continue;
      }

      summary.reversed += 1;
      const partial = result.debitAmount < creditAmount ? ` (partial, credit was ${creditAmount.toFixed(2)})` : '';
      console.log(
        `[ok] debited ${credit.currency} ${result.debitAmount.toFixed(2)} from ${credit.driver_user_id}${partial} (${result.balanceBefore} → ${result.balanceAfter})`
      );
    } catch (error) {
      summary.failed += 1;
      console.error(`[fail] ${credit.driver_user_id}: ${error?.message || error}`);
    }
  }

  console.log(`\nDone.`);
  console.log(`  reversed: ${summary.reversed}`);
  console.log(`  skipped:  ${summary.skipped}`);
  console.log(`  failed:   ${summary.failed}`);
  if (!apply) {
    console.log(`\nRe-run with --apply=true to actually reverse.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('revoke-wallet-grant failed:', error);
    process.exit(1);
  });

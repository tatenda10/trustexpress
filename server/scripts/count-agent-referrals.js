import 'dotenv/config';
import { query } from '../db/connection.js';

function getArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : '';
}

async function main() {
  const name = String(getArg('name') || process.argv[2] || '').trim();

  if (!name) {
    throw new Error('Usage: node scripts/count-agent-referrals.js --name="Hurry Mudenda"');
  }

  const agents = await query(
    `SELECT id, full_name, email, employee_code, is_active
     FROM agent_users
     WHERE LOWER(full_name) LIKE ?
     ORDER BY full_name ASC`,
    [`%${name.toLowerCase()}%`]
  );

  console.log('\n=== Matching Agents ===');
  console.log(JSON.stringify(agents, null, 2));

  for (const agent of agents) {
    const [driverCountRow] = await query(
      `SELECT COUNT(*) AS total
       FROM agent_driver_referrals
       WHERE agent_user_id = ?`,
      [agent.id]
    );

    const [passengerCountRow] = await query(
      `SELECT COUNT(*) AS total
       FROM agent_passenger_referrals
       WHERE agent_user_id = ?`,
      [agent.id]
    );

    console.log('\n=== Referral Counts ===');
    console.log(
      JSON.stringify(
        {
          agentId: agent.id,
          fullName: agent.full_name,
          email: agent.email,
          employeeCode: agent.employee_code || null,
          isActive: !!agent.is_active,
          driverReferralCount: Number(driverCountRow?.total || 0),
          passengerReferralCount: Number(passengerCountRow?.total || 0),
          totalReferralCount: Number(driverCountRow?.total || 0) + Number(passengerCountRow?.total || 0),
        },
        null,
        2
      )
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\ncount-agent-referrals failed:', error?.message || error);
    process.exit(1);
  });

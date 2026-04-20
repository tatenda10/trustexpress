import { query, withTransaction } from '../db/connection.js';

function mapTier(row) {
  return {
    id: Number(row.id),
    ridesThreshold: Number(row.rides_threshold || 0),
    rewardAmountUsd: Number(row.reward_amount_usd || 0),
    isActive: !!row.is_active,
    sortOrder: Number(row.sort_order || 0),
  };
}

function mapRedemption(row) {
  let tiers = [];
  try {
    const parsed = row.tiers_json ? JSON.parse(row.tiers_json) : [];
    tiers = Array.isArray(parsed) ? parsed : [];
  } catch {
    tiers = [];
  }
  return {
    id: Number(row.id),
    agentUserId: Number(row.agent_user_id || 0),
    agentName: row.agent_name || null,
    agentEmail: row.agent_email || null,
    ridesTotalAtRedeem: Number(row.rides_total_at_redeem || 0),
    cycleRidesAtRedeem: Number(row.cycle_rides_at_redeem || 0),
    highestThreshold: Number(row.highest_threshold || 0),
    amountUsd: Number(row.amount_usd || 0),
    status: String(row.status || 'pending'),
    reviewedAt: row.reviewed_at || null,
    reviewNote: row.review_note || null,
    reviewedByAdminId: row.reviewed_by_admin_id ? Number(row.reviewed_by_admin_id) : null,
    reviewedByAdminName: row.reviewed_by_admin_name || null,
    tiers,
    createdAt: row.created_at,
  };
}

async function getTotalCompletedRidesForAgent(agentUserId) {
  const rows = await query(
    `SELECT COUNT(CASE WHEN rr.status = 'completed' THEN 1 END) AS total_completed_rides
     FROM agent_driver_referrals r
     LEFT JOIN ride_requests rr ON rr.driver_user_id = r.driver_user_id
     WHERE r.agent_user_id = ?`,
    [agentUserId]
  );
  return Number(rows?.[0]?.total_completed_rides || 0);
}

async function getRewardState(agentUserId, connection = null) {
  const exec = connection ? connection.execute.bind(connection) : async (sql, params) => {
    const rows = await query(sql, params);
    return [rows];
  };
  const [rows] = await exec(
    `SELECT agent_user_id, last_reset_total_rides
     FROM agent_reward_state
     WHERE agent_user_id = ?
     LIMIT 1`,
    [agentUserId]
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    return { agentUserId, lastResetTotalRides: 0 };
  }
  return {
    agentUserId: Number(row.agent_user_id),
    lastResetTotalRides: Number(row.last_reset_total_rides || 0),
  };
}

async function ensureRewardStateRow(agentUserId, connection) {
  await connection.execute(
    `INSERT IGNORE INTO agent_reward_state (agent_user_id, last_reset_total_rides)
     VALUES (?, 0)`,
    [agentUserId]
  );
}

export async function listAgentRewardTiers() {
  const rows = await query(
    `SELECT id, rides_threshold, reward_amount_usd, is_active, sort_order, created_at, updated_at
     FROM agent_reward_tiers
     ORDER BY sort_order ASC, rides_threshold ASC, id ASC`
  );
  return rows.map(mapTier);
}

export async function replaceAgentRewardTiers(inputTiers = []) {
  await query('DELETE FROM agent_reward_tiers');
  const tiers = Array.isArray(inputTiers) ? inputTiers : [];
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index] || {};
    const ridesThreshold = Number(tier.ridesThreshold);
    const rewardAmountUsd = Number(tier.rewardAmountUsd);
    const isActive = tier.isActive === false ? 0 : 1;
    const sortOrder = Number.isFinite(Number(tier.sortOrder)) ? Number(tier.sortOrder) : index;
    if (!Number.isInteger(ridesThreshold) || ridesThreshold <= 0) continue;
    if (!Number.isFinite(rewardAmountUsd) || rewardAmountUsd < 0) continue;
    await query(
      `INSERT INTO agent_reward_tiers (rides_threshold, reward_amount_usd, is_active, sort_order)
       VALUES (?, ?, ?, ?)`,
      [ridesThreshold, rewardAmountUsd, isActive, sortOrder]
    );
  }
  return listAgentRewardTiers();
}

function computeUnlockedTiersForCycleRides(cycleRides, activeTiers) {
  return activeTiers.filter((tier) => cycleRides >= tier.ridesThreshold);
}

export async function getAgentRewardProgress(agentUserId, providedTiers = null) {
  const tiers = Array.isArray(providedTiers) ? providedTiers : await listAgentRewardTiers();
  const activeTiers = tiers
    .filter((tier) => tier.isActive)
    .sort((a, b) => a.ridesThreshold - b.ridesThreshold);

  const [rows, totalCompletedRides, rewardState, redemptionRows, redeemedSumRows, pendingRows] = await Promise.all([
    query(
      `SELECT
        r.id AS referral_id,
        r.driver_user_id,
        r.created_at AS referred_at,
        COUNT(CASE WHEN rr.status = 'completed' THEN 1 END) AS completed_rides
      FROM agent_driver_referrals r
      LEFT JOIN ride_requests rr ON rr.driver_user_id = r.driver_user_id
      WHERE r.agent_user_id = ?
      GROUP BY r.id, r.driver_user_id, r.created_at
      ORDER BY r.created_at DESC, r.id DESC`,
      [agentUserId]
    ),
    getTotalCompletedRidesForAgent(agentUserId),
    getRewardState(agentUserId),
    query(
      `SELECT id, agent_user_id, rides_total_at_redeem, cycle_rides_at_redeem, highest_threshold, amount_usd, tiers_json,
              status, reviewed_by_admin_id, reviewed_at, review_note, created_at
       FROM agent_reward_redemptions
       WHERE agent_user_id = ?
       ORDER BY id DESC
       LIMIT 50`,
      [agentUserId]
    ),
    query(
      `SELECT COALESCE(SUM(amount_usd), 0) AS total_redeemed_usd
       FROM agent_reward_redemptions
       WHERE agent_user_id = ? AND status = 'processed'`,
      [agentUserId]
    ),
    query(
      `SELECT
         COUNT(*) AS pending_count,
         COALESCE(SUM(amount_usd), 0) AS pending_amount_usd
       FROM agent_reward_redemptions
       WHERE agent_user_id = ? AND status = 'pending'`,
      [agentUserId]
    ),
  ]);

  const driverProgress = rows.map((row) => ({
    referralId: Number(row.referral_id),
    driverUserId: row.driver_user_id,
    referredAt: row.referred_at,
    completedRides: Number(row.completed_rides || 0),
  }));

  const totalReferredDrivers = driverProgress.length;
  const lastResetTotalRides = Number(rewardState.lastResetTotalRides || 0);
  const cycleRides = Math.max(0, totalCompletedRides - lastResetTotalRides);

  const unlockedThisCycle = computeUnlockedTiersForCycleRides(cycleRides, activeTiers);
  const pendingPayoutUsd = unlockedThisCycle.reduce((sum, tier) => sum + Number(tier.rewardAmountUsd || 0), 0);

  const tiersProgress = activeTiers.map((tier) => {
    const isUnlocked = cycleRides >= tier.ridesThreshold;
    return {
      ridesThreshold: tier.ridesThreshold,
      rewardAmountUsd: tier.rewardAmountUsd,
      isUnlocked,
      payoutUsd: isUnlocked ? Number(tier.rewardAmountUsd || 0) : 0,
      isActive: tier.isActive,
    };
  });

  const redeemedRows = Array.isArray(redemptionRows) ? redemptionRows : [];
  const lifetimeRedeemedUsd = Number(redeemedSumRows?.[0]?.total_redeemed_usd || 0);
  const pendingRedemptionCount = Number(pendingRows?.[0]?.pending_count || 0);
  const pendingRedemptionAmountUsd = Number(pendingRows?.[0]?.pending_amount_usd || 0);

  return {
    tiers: tiers.map((tier) => ({ ...tier })),
    driverProgress,
    redemptionHistory: redeemedRows.map(mapRedemption),
    summary: {
      totalReferredDrivers,
      totalCompletedRides,
      lastResetTotalRides,
      cycleRides,
      unlockedTierCount: unlockedThisCycle.length,
      /** Back-compat: dashboard previously used this name for “eligible milestones count”. */
      eligibleDrivers: unlockedThisCycle.length,
      pendingPayoutUsd: Number(pendingPayoutUsd.toFixed(2)),
      /** Back-compat: dashboard previously used this name for payout display. */
      totalPayoutUsd: Number(pendingPayoutUsd.toFixed(2)),
      lifetimeRedeemedUsd: Number(lifetimeRedeemedUsd.toFixed(2)),
      pendingRedemptionCount,
      pendingRedemptionAmountUsd: Number(pendingRedemptionAmountUsd.toFixed(2)),
      nextTier: activeTiers.find((tier) => cycleRides < tier.ridesThreshold) || null,
    },
    tiersProgress,
  };
}

export async function redeemAgentRewards(agentUserId) {
  return withTransaction(async (connection) => {
    await ensureRewardStateRow(agentUserId, connection);

    const tiers = await listAgentRewardTiers();
    const activeTiers = tiers
      .filter((tier) => tier.isActive)
      .sort((a, b) => a.ridesThreshold - b.ridesThreshold);

    const state = await getRewardState(agentUserId, connection);
    const [pendingRows] = await connection.execute(
      `SELECT COUNT(*) AS pending_count
       FROM agent_reward_redemptions
       WHERE agent_user_id = ? AND status = 'pending'`,
      [agentUserId]
    );
    const pendingCount = Number((Array.isArray(pendingRows) ? pendingRows[0] : null)?.pending_count || 0);
    if (pendingCount > 0) {
      throw new Error('PENDING_REDEMPTION_EXISTS');
    }
    const totalCompletedRides = await (async () => {
      const [agg] = await connection.execute(
        `SELECT COUNT(CASE WHEN rr.status = 'completed' THEN 1 END) AS total_completed_rides
         FROM agent_driver_referrals r
         LEFT JOIN ride_requests rr ON rr.driver_user_id = r.driver_user_id
         WHERE r.agent_user_id = ?`,
        [agentUserId]
      );
      const row = Array.isArray(agg) ? agg[0] : null;
      return Number(row?.total_completed_rides || 0);
    })();

    const lastResetTotalRides = Number(state.lastResetTotalRides || 0);
    const cycleRides = Math.max(0, totalCompletedRides - lastResetTotalRides);

    const unlocked = computeUnlockedTiersForCycleRides(cycleRides, activeTiers);
    if (!unlocked.length) {
      const err = new Error('NOTHING_TO_REDEEM');
      throw err;
    }

    const amountUsd = unlocked.reduce((sum, tier) => sum + Number(tier.rewardAmountUsd || 0), 0);
    const highestThreshold = Math.max(...unlocked.map((tier) => tier.ridesThreshold));
    const tiersPayload = unlocked.map((tier) => ({
      ridesThreshold: tier.ridesThreshold,
      rewardAmountUsd: tier.rewardAmountUsd,
    }));

    await connection.execute(
      `INSERT INTO agent_reward_redemptions
        (agent_user_id, rides_total_at_redeem, cycle_rides_at_redeem, highest_threshold, amount_usd, tiers_json, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [
        agentUserId,
        totalCompletedRides,
        cycleRides,
        highestThreshold,
        Number(amountUsd.toFixed(2)),
        JSON.stringify(tiersPayload),
      ]
    );

    return {
      ok: true,
      request: {
        amountUsd: Number(amountUsd.toFixed(2)),
        highestThreshold,
        cycleRidesAtRedeem: cycleRides,
        ridesTotalAtRedeem: totalCompletedRides,
        tiers: tiersPayload,
        status: 'pending',
      },
    };
  });
}

export async function listAdminRedemptionRequests() {
  const rows = await query(
    `SELECT
      r.id,
      r.agent_user_id,
      a.full_name AS agent_name,
      a.email AS agent_email,
      r.rides_total_at_redeem,
      r.cycle_rides_at_redeem,
      r.highest_threshold,
      r.amount_usd,
      r.tiers_json,
      r.status,
      r.reviewed_by_admin_id,
      reviewer.full_name AS reviewed_by_admin_name,
      r.reviewed_at,
      r.review_note,
      r.created_at
    FROM agent_reward_redemptions r
    INNER JOIN agent_users a ON a.id = r.agent_user_id
    LEFT JOIN admin_users reviewer ON reviewer.id = r.reviewed_by_admin_id
    ORDER BY
      CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END,
      r.created_at DESC,
      r.id DESC
    LIMIT 300`
  );
  return rows.map(mapRedemption);
}

export async function reviewRedemptionRequest({ redemptionId, nextStatus, adminId, reviewNote = '' }) {
  return withTransaction(async (connection) => {
    const [rows] = await connection.execute(
      `SELECT id, agent_user_id, rides_total_at_redeem, status
       FROM agent_reward_redemptions
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [redemptionId]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) throw new Error('REDEMPTION_NOT_FOUND');
    if (String(row.status || '') !== 'pending') throw new Error('REDEMPTION_ALREADY_REVIEWED');

    if (nextStatus === 'processed') {
      await ensureRewardStateRow(Number(row.agent_user_id), connection);
      await connection.execute(
        `UPDATE agent_reward_state
         SET last_reset_total_rides = GREATEST(last_reset_total_rides, ?)
         WHERE agent_user_id = ?`,
        [Number(row.rides_total_at_redeem || 0), Number(row.agent_user_id)]
      );
    }

    await connection.execute(
      `UPDATE agent_reward_redemptions
       SET status = ?, reviewed_by_admin_id = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ?
       WHERE id = ?`,
      [nextStatus, adminId, reviewNote || null, redemptionId]
    );

    return { ok: true, id: redemptionId, status: nextStatus };
  });
}

export async function listAdminAgentRewardSummary() {
  const tiers = await listAgentRewardTiers();
  const agentRows = await query(
    `SELECT id, full_name, email, phone_number, employee_code, is_active
     FROM agent_users
     ORDER BY created_at DESC, id DESC`
  );

  const agents = await Promise.all(
    agentRows.map(async (agent) => {
      const rewards = await getAgentRewardProgress(agent.id, tiers);
      return {
        id: Number(agent.id),
        fullName: agent.full_name,
        email: agent.email,
        phoneNumber: agent.phone_number || '',
        employeeCode: agent.employee_code || '',
        isActive: !!agent.is_active,
        rewardSummary: rewards.summary,
      };
    })
  );

  const totals = agents.reduce((acc, agent) => {
    acc.totalAgents += 1;
    acc.totalUnlockedTiers += Number(agent.rewardSummary?.unlockedTierCount || 0);
    acc.totalCompletedRides += Number(agent.rewardSummary?.totalCompletedRides || 0);
    acc.totalPendingPayoutUsd += Number(agent.rewardSummary?.pendingPayoutUsd || 0);
    acc.totalLifetimeRedeemedUsd += Number(agent.rewardSummary?.lifetimeRedeemedUsd || 0);
      acc.totalPendingRequests += Number(agent.rewardSummary?.pendingRedemptionCount || 0);
    return acc;
  }, {
    totalAgents: 0,
    totalUnlockedTiers: 0,
    totalCompletedRides: 0,
    totalPendingPayoutUsd: 0,
    totalLifetimeRedeemedUsd: 0,
      totalPendingRequests: 0,
  });

  return {
    tiers,
    agents,
    totals: {
      ...totals,
      // Back-compat for older admin UI that used totalPayoutUsd as “eligible/pending”.
      totalPayoutUsd: Number(totals.totalPendingPayoutUsd.toFixed(2)),
      totalPendingPayoutUsd: Number(totals.totalPendingPayoutUsd.toFixed(2)),
      totalLifetimeRedeemedUsd: Number(totals.totalLifetimeRedeemedUsd.toFixed(2)),
    },
  };
}

export function formatWalletCurrency(value, currency = 'ZAR') {
  return `${String(currency || 'ZAR').toUpperCase()} ${Number(value || 0).toFixed(2)}`;
}

export function formatWalletDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-ZW', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function getTransactionMeta(transaction) {
  if (transaction?.transactionType === 'top_up_credit' || transaction?.transactionType === 'manual_credit') {
    return {
      icon: 'cash-outline',
      iconBg: '#DCFCE7',
      amountColor: 'text-green-600',
      amountPrefix: '+',
      title: transaction?.transactionType === 'manual_credit'
        ? 'Wallet credit'
        : transaction.paymentMethod
        ? `Top-up via ${String(transaction.paymentMethod).replace(/_/g, ' ')}`
        : 'Wallet top-up',
    };
  }
  if (transaction?.transactionType === 'captain_promo_credit') {
    return {
      icon: 'gift-outline',
      iconBg: '#E0F2FE',
      amountColor: 'text-green-600',
      amountPrefix: '+',
      title: 'Reward balance added',
    };
  }
  if (transaction?.transactionType === 'promo_commission_debit') {
    return {
      icon: 'remove-circle-outline',
      iconBg: '#FEE2E2',
      amountColor: 'text-red-600',
      amountPrefix: '-',
      title: transaction?.tripId ? `Trip #${transaction.tripId} service fee` : 'Service fee paid from rewards',
    };
  }
  if (transaction?.transactionType === 'manual_debit') {
    return {
      icon: 'arrow-up-circle-outline',
      iconBg: '#FEE2E2',
      amountColor: 'text-red-600',
      amountPrefix: '-',
      title: transaction?.sourceType === 'driver_wallet_cashout' ? 'Cash out' : 'Wallet debit',
    };
  }
  return {
    icon: 'remove-circle-outline',
    iconBg: '#FEE2E2',
    amountColor: 'text-red-600',
    amountPrefix: '-',
    title: transaction?.tripId ? `Trip #${transaction.tripId} service fee` : 'Service fee debit',
  };
}

export function formatTransactionTypeLabel(transactionType) {
  const type = String(transactionType || '').trim().toLowerCase();
  if (type === 'commission_debit') return 'SERVICE FEE';
  if (type === 'promo_commission_debit') return 'PAID FROM REWARD BALANCE';
  if (type === 'captain_promo_credit') return 'REWARD BALANCE';
  if (type === 'manual_credit') return 'WALLET CREDIT';
  if (type === 'manual_debit') return 'WALLET DEBIT';
  return String(transactionType || '').replace(/_/g, ' ').toUpperCase();
}

export function getTransactionDetailRows(transaction, fallbackCurrency = 'ZAR') {
  if (!transaction) return [];
  const meta = getTransactionMeta(transaction);
  const currency = transaction.currency || fallbackCurrency;
  return [
    ['Type', formatTransactionTypeLabel(transaction.transactionType)],
    ['Date', formatWalletDate(transaction.createdAt)],
    ['Amount', `${meta.amountPrefix}${formatWalletCurrency(Math.abs(Number(transaction.amount || 0)), currency)}`],
    transaction.tripId ? ['Trip', `#${transaction.tripId}`] : null,
    transaction.tripId ? ['Passenger', transaction.passengerName || 'Passenger'] : null,
    transaction.tripId ? ['Fare', formatWalletCurrency(transaction.tripFareAmount, currency)] : null,
    transaction.paymentMethod
      ? ['Payment method', String(transaction.paymentMethod).replace(/_/g, ' ')]
      : null,
    transaction.commissionRatePercent
      ? ['Service fee', `${Number(transaction.commissionRatePercent).toFixed(1)}%`]
      : null,
    transaction.balanceBefore != null
      ? [transaction.transactionType === 'promo_commission_debit' ? 'Reward balance before' : 'Balance before', formatWalletCurrency(transaction.balanceBefore, currency)]
      : null,
    transaction.balanceAfter != null
      ? [transaction.transactionType === 'promo_commission_debit' ? 'Reward balance after' : 'Balance after', formatWalletCurrency(transaction.balanceAfter, currency)]
      : null,
  ].filter(Boolean);
}

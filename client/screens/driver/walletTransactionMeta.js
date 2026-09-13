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
  if (transaction?.transactionType === 'top_up_credit') {
    return {
      icon: 'cash-outline',
      iconBg: '#DCFCE7',
      amountColor: 'text-green-600',
      amountPrefix: '+',
      title: transaction.paymentMethod
        ? `Top-up via ${String(transaction.paymentMethod).replace(/_/g, ' ')}`
        : 'Wallet top-up',
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
      ? ['Balance before', formatWalletCurrency(transaction.balanceBefore, currency)]
      : null,
    transaction.balanceAfter != null
      ? ['Balance after', formatWalletCurrency(transaction.balanceAfter, currency)]
      : null,
  ].filter(Boolean);
}

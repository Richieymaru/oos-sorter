/** Feature funnels — pure attribution of orders to features. No network. */
const FEATURES = ['find-my-blaster', 'upgrade'];

/**
 * Attribute normalized orders to features via each line's `src`.
 *
 * Revenue approximation: no per-line price is available, so a line's share of
 * the order is order.amount * (line.qty / total qty in the order). Orders with
 * zero total qty or a falsy amount contribute 0 revenue (never NaN).
 *
 * `orders` is "orders touched": an order with lines from both features counts
 * once in EACH feature, so the per-feature counts can sum to more than the
 * true order total. Intentional.
 */
export function attributeOrders(orders) {
  const features = Object.fromEntries(FEATURES.map((f) => [f, { orders: 0, revenue: 0 }]));
  for (const order of orders || []) {
    const items = order.items || [];
    const totalQty = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
    const amount = Number(order.amount) || 0;
    const touched = new Set();
    for (const line of items) {
      if (!FEATURES.includes(line.src)) continue;
      touched.add(line.src);
      if (totalQty > 0 && amount) features[line.src].revenue += amount * ((Number(line.qty) || 0) / totalQty);
    }
    for (const f of touched) features[f].orders++;
  }
  return { currency: (orders && orders[0] && orders[0].currency) || 'USD', features };
}

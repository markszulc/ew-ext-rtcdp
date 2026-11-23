// Sample responses shaped like the AEP Segmentation API `/audiences` endpoint.
// Used when the panel runs in demo mode or outside Experience Workspace.

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

const audience = ({
  id, name, description, pql, profiles, evaluation = 'batch',
  origin = 'REAL_TIME_CUSTOMER_PROFILE', state = 'published', updatedDaysAgo = 1,
  labels = [], namespace = 'AEPSegments',
}) => ({
  id,
  audienceId: id,
  name,
  description,
  namespace,
  type: origin === 'REAL_TIME_CUSTOMER_PROFILE' ? 'SegmentDefinition' : 'ExternalSegment',
  originName: origin,
  lifecycleState: state,
  labels,
  mergePolicyId: 'ef006bbe-750e-4e81-85f0-0c6902192dcc',
  expression: pql ? { type: 'PQL', format: 'pql/text', value: pql } : undefined,
  evaluationInfo: {
    batch: { enabled: evaluation === 'batch' },
    continuous: { enabled: evaluation === 'streaming' },
    synchronous: { enabled: evaluation === 'edge' },
  },
  metrics: { data: { totalProfiles: profiles } },
  updateTime: now - updatedDaysAgo * DAY,
  creationTime: now - (updatedDaysAgo + 90) * DAY,
});

export const DEMO_AUDIENCES = [
  audience({
    id: 'a1f3c2d0-0001-4c1e-9a10-espresso0001',
    name: 'Espresso Enthusiasts',
    description: 'Customers who bought espresso beans or espresso machines at least twice in the last 90 days.',
    pql: 'commerce.order.productListItems.exists(p, p.name.contains("espresso")) and count >= 2 last 90 days',
    profiles: 184230,
    evaluation: 'batch',
    updatedDaysAgo: 1,
    labels: ['core/C1'],
  }),
  audience({
    id: 'a1f3c2d0-0002-4c1e-9a10-coldbrew0002',
    name: 'Cold Brew Summer Buyers',
    description: 'Purchased cold brew, iced coffee or nitro products during the last summer season.',
    pql: 'productListItems.category in ["cold brew", "iced coffee", "nitro"] and timestamp occurs during summer',
    profiles: 96410,
    evaluation: 'batch',
    updatedDaysAgo: 2,
  }),
  audience({
    id: 'a1f3c2d0-0003-4c1e-9a10-mybarista0003',
    name: 'MyBarista Subscribers – Active',
    description: 'Active MyBarista coffee subscription members with a delivery in the last 45 days.',
    pql: 'subscription.plan = "mybarista" and subscription.status = "active"',
    profiles: 58122,
    evaluation: 'streaming',
    updatedDaysAgo: 0,
    labels: ['core/C1', 'core/C5'],
  }),
  audience({
    id: 'a1f3c2d0-0004-4c1e-9a10-lapsedsub0004',
    name: 'Lapsed Subscribers (90 days)',
    description: 'Former MyBarista subscribers who cancelled or paused their subscription in the last 90 days. Win-back target.',
    pql: 'subscription.status in ["cancelled", "paused"] and subscription.endDate occurs < 90 days before now',
    profiles: 12877,
    evaluation: 'batch',
    updatedDaysAgo: 1,
  }),
  audience({
    id: 'a1f3c2d0-0005-4c1e-9a10-highvalue0005',
    name: 'High-Value Customers (Top 10% CLV)',
    description: 'Customers in the top decile of predicted customer lifetime value. Prioritise for premium and loyalty offers.',
    pql: 'customerAI.clvDecile = 10',
    profiles: 41005,
    evaluation: 'batch',
    updatedDaysAgo: 3,
    labels: ['core/C1', 'core/C9'],
  }),
  audience({
    id: 'a1f3c2d0-0006-4c1e-9a10-sustain00006',
    name: 'Sustainability-Minded Shoppers',
    description: 'Engaged with sustainability, fair trade, organic or ethically sourced coffee content or products.',
    pql: 'web.webPageDetails.name.contains("sustainability") or productListItems.tags in ["fair trade", "organic", "ethically sourced"]',
    profiles: 73560,
    evaluation: 'streaming',
    updatedDaysAgo: 0,
  }),
  audience({
    id: 'a1f3c2d0-0007-4c1e-9a10-firstvisit007',
    name: 'First-Time Visitors',
    description: 'Visitors on their first session with no known purchase history. Ideal for welcome offers.',
    pql: 'count(web.sessions) = 1 and not exists commerce.order',
    profiles: 312890,
    evaluation: 'edge',
    updatedDaysAgo: 0,
  }),
  audience({
    id: 'a1f3c2d0-0008-4c1e-9a10-cartabndn008',
    name: 'Cart Abandoners – Last 7 Days',
    description: 'Added coffee or brewing equipment to cart but did not complete checkout in the last 7 days.',
    pql: 'commerce.productListAdds occurs in last 7 days and not commerce.purchases occurs in last 7 days',
    profiles: 21344,
    evaluation: 'streaming',
    updatedDaysAgo: 0,
  }),
  audience({
    id: 'a1f3c2d0-0009-4c1e-9a10-homebarist009',
    name: 'Home Baristas – Equipment Browsers',
    description: 'Browsed grinders, pour-over kits, kettles or espresso machines three or more times this month.',
    pql: 'web.webPageDetails.siteSection in ["grinders", "pour-over", "kettles", "machines"] and count >= 3 last 30 days',
    profiles: 45781,
    evaluation: 'batch',
    updatedDaysAgo: 2,
  }),
  audience({
    id: 'a1f3c2d0-0010-4c1e-9a10-giftbuyer010',
    name: 'Holiday Gift Buyers',
    description: 'Purchased gift cards, gift boxes or shipped orders to a different address during the holiday season.',
    pql: 'commerce.order.isGift = true and timestamp occurs during holidays',
    profiles: 33019,
    evaluation: 'batch',
    updatedDaysAgo: 5,
  }),
  audience({
    id: 'a1f3c2d0-0011-4c1e-9a10-loyaltygld11',
    name: 'Loyalty Gold Tier',
    description: 'Members of the Frescopa rewards loyalty program in Gold tier or above.',
    pql: 'loyalty.tier in ["gold", "platinum"]',
    profiles: 27450,
    evaluation: 'streaming',
    updatedDaysAgo: 1,
    labels: ['core/C1'],
  }),
  audience({
    id: 'crm-upload-0012-decaf-tea',
    name: 'Decaf & Tea Preference (CRM import)',
    description: 'Customers who told the call centre they prefer decaf coffee or tea. Imported from CRM.',
    profiles: 8932,
    origin: 'CUSTOM_UPLOAD',
    namespace: 'CustomerAudienceUpload',
    updatedDaysAgo: 14,
  }),
  audience({
    id: 'a1f3c2d0-0013-4c1e-9a10-mobileapac13',
    name: 'Mobile App Users – APAC',
    description: 'Logged in to the Frescopa mobile app from Australia, New Zealand, Japan or Singapore in the last 30 days.',
    pql: 'application.launches occurs in last 30 days and geo.countryCode in ["AU", "NZ", "JP", "SG"]',
    profiles: 66218,
    evaluation: 'streaming',
    updatedDaysAgo: 0,
  }),
  audience({
    id: 'a1f3c2d0-0015-4c1e-9a10-fitnessfuel15',
    name: 'Fitness Fuel Seekers',
    description: 'Active, health-focused customers who buy protein coffee, cold brew or low-sugar espresso drinks before or after a workout.',
    pql: 'productListItems.tags contains_any ["protein coffee", "pre-workout", "low sugar", "cold brew"] and fitness.appConnected = true occurs in last 60 days',
    profiles: 71584,
    evaluation: 'streaming',
    updatedDaysAgo: 0,
  }),
  audience({
    id: 'a1f3c2d0-0014-4c1e-9a10-draftaud0014',
    name: 'Single-Origin Explorers (draft)',
    description: 'Tried three or more single-origin coffees from different countries.',
    pql: 'productListItems.tags contains "single-origin" and distinctCount(origin) >= 3',
    profiles: 0,
    state: 'draft',
    updatedDaysAgo: 4,
  }),
];

export const DEMO_PAGE_HTML = `
<body><main><div>
  <h1>Brew the perfect espresso at home</h1>
  <p>From bean to cup: how to pick a grinder, dial in your espresso machine and
  choose ethically sourced, fair trade beans. Join MyBarista and get fresh coffee
  delivered every month.</p>
  <h2>Choosing your beans</h2>
  <p>Single-origin or blend? Our sustainability team visits every farm.</p>
  <h2>Subscribe and save</h2>
  <div class="metadata"><div><div>keywords</div><div>espresso, home barista, subscription</div></div></div>
</div></main></body>`;

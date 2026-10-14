import { CONSOLIDATION_ROLES } from './index';

/**
 * The container list: one line per tub (bins share a `binKey` when a tub is
 * split by service level), what it holds split by each order's service
 * level, and what is still coming toward it by station. Expanding a line
 * lists the orders in it and the orders on their way.
 */
export const CONSOLIDATE_LIST_SCHEMA = {
  'x-lt-layout': 'facet-table',
  'x-lt-group-by': 'metadata.binKey',
  'x-lt-related': {
    contents: { source: 'items' },
    coming: {
      source: 'query',
      query: {
        segment: CONSOLIDATION_ROLES.PREP,
        facets: { destination: '{{metadata.destination}}' },
        narrow: { serviceLevel: '{{metadata.lane}}' },
      },
    },
  },
  'x-lt-columns': [
    { label: 'Tub', value: '{{metadata.binKey}}', priority: 1 },
    { label: 'Lane', value: '{{metadata.lane}}', group: 'distinct', priority: 2 },
    { label: 'Ships to', value: '{{metadata.destination}}' },
    {
      label: 'Holds',
      related: 'contents',
      aggregate: 'count',
      splitBy: 'reciprocal.metadata.serviceLevel',
      labels: { standard: 'Standard', express: 'Express' },
    },
    { label: 'Coming', related: 'coming', aggregate: 'count', splitBy: 'role' },
    { label: 'Open since', value: '{{escalation.created_at}}', format: 'age', group: 'min', priority: 2 },
  ],
  'x-lt-row-detail': [
    {
      related: 'contents',
      label: 'Holds',
      columns: [
        { label: 'Order', value: '{{item.itemKey}}' },
        { label: 'Service', value: '{{metadata.serviceLevel}}' },
        { label: 'Placed', value: '{{item.at}}', format: 'date' },
      ],
    },
    {
      related: 'coming',
      label: 'Coming',
      columns: [
        { label: 'Order', value: '{{metadata.orderId}}' },
        { label: 'At', value: '{{escalation.role}}', format: 'role' },
        { label: 'Service', value: '{{metadata.serviceLevel}}' },
        { label: 'Since', value: '{{escalation.created_at}}', format: 'age' },
      ],
    },
  ],
  'x-lt-row-action': { action: 'view', label: 'Open' },
};

/** A station's list: the orders waiting there and where each is headed. */
export const STATION_LIST_SCHEMA = {
  'x-lt-layout': 'facet-table',
  'x-lt-columns': [
    { label: 'Order', value: '{{metadata.orderId}}' },
    { label: 'Ships to', value: '{{metadata.destination}}' },
    { label: 'Service', value: '{{metadata.serviceLevel}}' },
    { label: 'Waiting', value: '{{escalation.created_at}}', format: 'age', priority: 2 },
  ],
};

/** Each station's resolve form: one confirmation. */
export const STATION_FORM_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', title: 'Done at this station', default: true },
  },
};

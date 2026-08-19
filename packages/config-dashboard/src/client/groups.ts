/**
 * Coarse, curated grouping for known settings namespaces, so the left tree
 * is findable like a VS Code settings page. Unknown namespaces fall into a
 * trailing "其他 / Others" bucket. The grouping is static on purpose: the
 * runtime `describe()` snapshot stays the source of truth for what exists.
 */
export const NS_GROUPS: Array<{ id: string; namespaces: string[] }> = [
  {
    id: 'models',
    namespaces: ['llm-deepseek', 'llm-pi-ai', 'agent-default-model', 'web-search-deepseek', 'dsh-provider-proxy'],
  },
  {
    id: 'ui',
    namespaces: ['ui-theme', 'ui-onboarding', 'locale', 'pet', 'skin-background', 'remote-web-ui', 'dsh-better-sidebar'],
  },
  {
    id: 'exec',
    namespaces: ['bash', 'agent-loop', 'permissionPresets', 'dsh-vision-sidecar'],
  },
];

export const OTHER_GROUP_ID = '__other__';

/** Group index for a namespace: its curated group, else the trailing Other. */
export function groupIndexOf(ns: string): number {
  const idx = NS_GROUPS.findIndex((g) => g.namespaces.includes(ns));
  return idx === -1 ? NS_GROUPS.length : idx;
}

/** Ordered group ids, curated groups first and Other last. */
export function orderedGroupIds(): string[] {
  return [...NS_GROUPS.map((g) => g.id), OTHER_GROUP_ID];
}

export const PRODUCT_LIFECYCLE_STATES = Object.freeze([
  "NEEDS_INTERPRETATION",
  "PROPOSAL_PENDING",
  "CONFIRMED",
]);

function hasConfirmedStructure(model = {}) {
  const confirmations = model.humanIntent?.productStructureConfirmations || [];
  const groups = Object.values(model.productHierarchy?.groups || {});
  const features = Object.values(model.features || {});
  return confirmations.some((confirmation) => {
    const proposalId = confirmation?.proposalId;
    if (!proposalId) return false;
    const confirmedGroups = groups.filter((group) => group.humanIntent?.confirmedFromProposal === proposalId && group.featureIds?.length);
    const confirmedFeatures = features.filter((feature) => feature.humanIntent?.confirmedFromProposal === proposalId);
    return confirmedGroups.length > 0 && confirmedFeatures.length > 0;
  });
}

/**
 * Product lifecycle is the single semantic source for Product View banners,
 * proposal CTAs, and the MCP/API summary. Freshness and Feature Actionability
 * remain separate axes.
 */
export function deriveProductLifecycleState(input = {}) {
  const model = input.model || input.productModel || {};
  const proposals = Array.isArray(input.proposals) ? input.proposals : [];
  if (proposals.some((proposal) => proposal?.status === "pending")) {
    return {
      state: "PROPOSAL_PENDING",
      recommendedNextAction: "HUMAN_CONFIRM_PRODUCT_STRUCTURE",
      proposalCount: proposals.filter((proposal) => proposal?.status === "pending").length,
    };
  }
  if (hasConfirmedStructure(model)) {
    return { state: "CONFIRMED", recommendedNextAction: null, proposalCount: 0 };
  }
  return {
    state: "NEEDS_INTERPRETATION",
    recommendedNextAction: "PRODUCT_STRUCTURE_PROPOSAL",
    proposalCount: 0,
  };
}

export function productStructureStatusForLifecycle(state) {
  if (state === "PROPOSAL_PENDING") return "AWAITING_HUMAN_CONFIRMATION";
  if (state === "CONFIRMED") return "CONFIRMED";
  return "PROPOSED";
}

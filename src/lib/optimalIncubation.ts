import type { IPets } from "@/lib/interface";

export type IncubationGender = "male" | "female";

export interface IIncubationSelection {
    id: string;
    pet: IPets;
    gender: IncubationGender;
    shiny: boolean;
    colorful: boolean;
}

export interface IIncubationPair {
    female: IIncubationSelection;
    male: IIncubationSelection;
    sharedEggGroups: number[];
    geneReady: boolean;
    femaleTraitRank: number;
    maleTraitRank: number;
    pairTraitRank: number;
    score: number;
}

export interface IIncubationAssignment extends IIncubationPair {}

export interface IIncubationSelectionIssue {
    selection: IIncubationSelection;
    reason: string;
}

export interface IIncubationPlan {
    nestCount: number;
    strategy: "exact" | "greedy";
    selectedMales: IIncubationSelection[];
    assignments: IIncubationAssignment[];
    placedSelections: IIncubationSelection[];
    unusedSelections: IIncubationSelection[];
    unmatchedFemales: IIncubationSelection[];
    invalidSelections: IIncubationSelectionIssue[];
    allPairs: IIncubationPair[];
    eggCount: number;
    geneReadyCount: number;
    shinyPairCount: number;
    colorfulPairCount: number;
    totalScore: number;
    focusIncluded: boolean;
    focusSelectionIds: string[];
}

interface IEvaluatedPlan {
    strategy: "exact" | "greedy";
    selectedMales: IIncubationSelection[];
    assignments: IIncubationAssignment[];
    eggCount: number;
    geneReadyCount: number;
    shinyPairCount: number;
    colorfulPairCount: number;
    totalScore: number;
    focusIncluded: boolean;
    focusSelectionIds: string[];
}

interface IPlanBuildInput {
    selections: IIncubationSelection[];
    nestCount: number;
    strategy: "exact" | "greedy";
    selectedMales: IIncubationSelection[];
    assignments: IIncubationAssignment[];
    invalidSelections: IIncubationSelectionIssue[];
    allPairs: IIncubationPair[];
    focusSelectionIds: string[];
}

const EXACT_MALE_LIMIT = 16;
const DEFAULT_PLAN_LIMIT = 10;

export function getSelectionIssue(selection: IIncubationSelection) {
    const profile = selection.pet.breeding_profile;

    if (!profile) {
        return "缺少配种规则数据";
    }

    if (!profile.egg_groups.length) {
        return "暂无蛋组数据";
    }

    if (selection.gender === "male" && profile.male_rate === 0) {
        return "资料显示无法作为父体";
    }

    if (selection.gender === "female" && profile.female_rate === 0) {
        return "资料显示无法作为母体";
    }

    return null;
}

export function getSharedEggGroups(female: IPets, male: IPets) {
    const femaleEggGroups = female.breeding_profile?.egg_groups ?? [];
    const maleEggGroups = male.breeding_profile?.egg_groups ?? [];
    const maleEggGroupSet = new Set(maleEggGroups);

    return femaleEggGroups.filter((groupId) => maleEggGroupSet.has(groupId));
}

export function getSelectionTraitRank(selection: IIncubationSelection) {
    if (selection.shiny && selection.colorful) {
        return 3;
    }

    if (selection.shiny) {
        return 2;
    }

    if (selection.colorful) {
        return 1;
    }

    return 0;
}

export function buildIncubationPair(
    female: IIncubationSelection,
    male: IIncubationSelection,
): IIncubationPair | null {
    const sharedEggGroups = getSharedEggGroups(female.pet, male.pet);

    if (!sharedEggGroups.length) {
        return null;
    }

    const geneReady =
        female.shiny && female.colorful && male.shiny && male.colorful;
    const femaleTraitRank = getSelectionTraitRank(female);
    const maleTraitRank = getSelectionTraitRank(male);
    const pairTraitRank = Math.min(femaleTraitRank, maleTraitRank);
    const score =
        pairTraitRank * 1000 +
        femaleTraitRank * 120 +
        maleTraitRank * 90 +
        sharedEggGroups.length * 20;

    return {
        female,
        male,
        sharedEggGroups,
        geneReady,
        femaleTraitRank,
        maleTraitRank,
        pairTraitRank,
        score,
    };
}

export function optimizeIncubationPlan(
    selections: IIncubationSelection[],
    nestCount: number,
    focusSelectionIds: string[] = [],
): IIncubationPlan {
    const plans = optimizeIncubationPlans(
        selections,
        nestCount,
        focusSelectionIds,
        1,
    );

    return plans[0] ?? optimizeIncubationPlans(selections, nestCount, [], 1)[0]!;
}

export function optimizeIncubationPlans(
    selections: IIncubationSelection[],
    nestCount: number,
    focusSelectionIds: string[] = [],
    limit = DEFAULT_PLAN_LIMIT,
): IIncubationPlan[] {
    const normalizedNestCount = Math.max(0, Math.floor(nestCount));
    const invalidSelections = selections
        .map((selection) => {
            const reason = getSelectionIssue(selection);

            return reason ? { selection, reason } : null;
        })
        .filter((item): item is IIncubationSelectionIssue => item !== null);
    const invalidSelectionIds = new Set(
        invalidSelections.map((item) => item.selection.id),
    );
    const validSelections = selections.filter(
        (selection) => !invalidSelectionIds.has(selection.id),
    );
    const validSelectionIds = new Set(
        validSelections.map((selection) => selection.id),
    );
    const effectiveFocusSelectionIds = focusSelectionIds.filter((id) =>
        validSelectionIds.has(id),
    );
    const females = validSelections.filter(
        (selection) => selection.gender === "female",
    );
    const males = validSelections.filter(
        (selection) => selection.gender === "male",
    );
    const allPairs = buildAllPairs(females, males);
    const emptyPlan = buildFinalPlan({
        selections,
        nestCount: normalizedNestCount,
        strategy: males.length <= EXACT_MALE_LIMIT ? "exact" : "greedy",
        selectedMales: [],
        assignments: [],
        invalidSelections,
        allPairs,
        focusSelectionIds: effectiveFocusSelectionIds,
    });

    if (normalizedNestCount < 2 || !females.length || !males.length) {
        return [emptyPlan];
    }

    const maxMaleSlots = Math.min(males.length, normalizedNestCount - 1);

    if (maxMaleSlots <= 0 || !allPairs.length) {
        return [emptyPlan];
    }

    const candidates =
        males.length <= EXACT_MALE_LIMIT
            ? findExactPlans(
                  males,
                  females,
                  allPairs,
                  normalizedNestCount,
                  effectiveFocusSelectionIds,
              )
            : findGreedyPlans(
                  males,
                  females,
                  allPairs,
                  normalizedNestCount,
                  effectiveFocusSelectionIds,
                  limit,
              );

    if (!candidates.length) {
        return [emptyPlan];
    }

    const uniqueCandidates = dedupePlans(candidates).sort(comparePlans);

    return uniqueCandidates.slice(0, limit).map((plan) => {
        return buildFinalPlan({
            selections,
            nestCount: normalizedNestCount,
            strategy: plan.strategy,
            selectedMales: plan.selectedMales,
            assignments: plan.assignments,
            invalidSelections,
            allPairs,
            focusSelectionIds: effectiveFocusSelectionIds,
        });
    });
}

function buildAllPairs(
    females: IIncubationSelection[],
    males: IIncubationSelection[],
) {
    const pairs: IIncubationPair[] = [];

    for (const female of females) {
        for (const male of males) {
            const pair = buildIncubationPair(female, male);

            if (pair) {
                pairs.push(pair);
            }
        }
    }

    return pairs;
}

function findExactPlans(
    males: IIncubationSelection[],
    females: IIncubationSelection[],
    allPairs: IIncubationPair[],
    nestCount: number,
    focusSelectionIds: string[],
) {
    const maxMask = 1 << males.length;
    const plans: IEvaluatedPlan[] = [];

    for (let mask = 1; mask < maxMask; mask += 1) {
        const maleCount = countBits(mask);

        if (maleCount >= nestCount) {
            continue;
        }

        const selectedMales = males.filter((_, index) => {
            return (mask & (1 << index)) !== 0;
        });
        const candidate = evaluateMaleSet(
            selectedMales,
            females,
            allPairs,
            nestCount,
            "exact",
            focusSelectionIds,
        );

        if (candidate.eggCount && matchesFocus(candidate, focusSelectionIds)) {
            plans.push(candidate);
        }
    }

    return plans;
}

function findGreedyPlans(
    males: IIncubationSelection[],
    females: IIncubationSelection[],
    allPairs: IIncubationPair[],
    nestCount: number,
    focusSelectionIds: string[],
    limit: number,
) {
    const seedMales = [...males].sort((left, right) => {
        return (
            getMaleCoverageScore(right, allPairs) -
                getMaleCoverageScore(left, allPairs) ||
            getSelectionTraitRank(right) - getSelectionTraitRank(left) ||
            left.pet.localized.zh.name.localeCompare(
                right.pet.localized.zh.name,
                "zh-CN",
            )
        );
    });
    const plans: IEvaluatedPlan[] = [];

    for (const seedMale of seedMales.slice(0, Math.max(limit * 2, 12))) {
        const plan = buildGreedyPlanFromSeed(
            seedMale,
            males,
            females,
            allPairs,
            nestCount,
            focusSelectionIds,
        );

        if (plan.eggCount && matchesFocus(plan, focusSelectionIds)) {
            plans.push(plan);
        }
    }

    return plans;
}

function buildGreedyPlanFromSeed(
    seedMale: IIncubationSelection,
    males: IIncubationSelection[],
    females: IIncubationSelection[],
    allPairs: IIncubationPair[],
    nestCount: number,
    focusSelectionIds: string[],
) {
    const maxMaleSlots = Math.min(males.length, nestCount - 1);
    const chosen: IIncubationSelection[] = [seedMale];
    let bestPlan = evaluateMaleSet(
        chosen,
        females,
        allPairs,
        nestCount,
        "greedy",
        focusSelectionIds,
    );

    for (let slot = 1; slot < maxMaleSlots; slot += 1) {
        let bestNextMale: IIncubationSelection | null = null;
        let bestNextPlan: IEvaluatedPlan | null = null;

        for (const male of males) {
            if (chosen.some((item) => item.id === male.id)) {
                continue;
            }

            const candidate = evaluateMaleSet(
                [...chosen, male],
                females,
                allPairs,
                nestCount,
                "greedy",
                focusSelectionIds,
            );

            if (!bestNextPlan || comparePlans(candidate, bestNextPlan) < 0) {
                bestNextMale = male;
                bestNextPlan = candidate;
            }
        }

        if (!bestNextMale || !bestNextPlan) {
            break;
        }

        chosen.push(bestNextMale);

        if (comparePlans(bestNextPlan, bestPlan) < 0) {
            bestPlan = bestNextPlan;
        }
    }

    return bestPlan;
}

function evaluateMaleSet(
    initialMales: IIncubationSelection[],
    females: IIncubationSelection[],
    allPairs: IIncubationPair[],
    nestCount: number,
    strategy: "exact" | "greedy",
    focusSelectionIds: string[],
): IEvaluatedPlan {
    let selectedMales = initialMales;
    let assignments: IIncubationAssignment[] = [];

    for (let iteration = 0; iteration < initialMales.length + 1; iteration += 1) {
        const femaleCapacity = nestCount - selectedMales.length;

        if (femaleCapacity <= 0 || !selectedMales.length) {
            assignments = [];
            break;
        }

        const selectedMaleIds = new Set(selectedMales.map((male) => male.id));

        assignments = females
            .map((female) => {
                return allPairs
                    .filter((pair) => {
                        return (
                            pair.female.id === female.id &&
                            selectedMaleIds.has(pair.male.id)
                        );
                    })
                    .sort(comparePairQuality)[0];
            })
            .filter(
                (pair): pair is IIncubationAssignment => pair !== undefined,
            )
            .sort(comparePairQuality)
            .slice(0, femaleCapacity);

        const usedMaleIds = new Set(
            assignments.map((assignment) => assignment.male.id),
        );

        if (usedMaleIds.size === selectedMales.length) {
            break;
        }

        selectedMales = selectedMales.filter((male) =>
            usedMaleIds.has(male.id),
        );
    }

    return buildEvaluatedPlan(
        strategy,
        selectedMales,
        assignments,
        focusSelectionIds,
    );
}

function buildEvaluatedPlan(
    strategy: "exact" | "greedy",
    selectedMales: IIncubationSelection[],
    assignments: IIncubationAssignment[],
    focusSelectionIds: string[],
): IEvaluatedPlan {
    const focusIncluded = isFocusIncluded(
        selectedMales,
        assignments,
        focusSelectionIds,
    );

    return {
        strategy,
        selectedMales,
        assignments,
        eggCount: assignments.length,
        geneReadyCount: assignments.filter((assignment) => assignment.geneReady)
            .length,
        shinyPairCount: assignments.filter(
            (assignment) => assignment.pairTraitRank >= 2,
        ).length,
        colorfulPairCount: assignments.filter(
            (assignment) => assignment.pairTraitRank >= 1,
        ).length,
        totalScore: assignments.reduce(
            (total, assignment) => total + assignment.score,
            0,
        ),
        focusIncluded,
        focusSelectionIds,
    };
}

function buildFinalPlan(input: IPlanBuildInput): IIncubationPlan {
    const evaluatedPlan = buildEvaluatedPlan(
        input.strategy,
        input.selectedMales,
        input.assignments,
        input.focusSelectionIds,
    );
    const placedSelectionIds = new Set([
        ...input.selectedMales.map((selection) => selection.id),
        ...input.assignments.map((assignment) => assignment.female.id),
    ]);
    const matchedFemaleIds = new Set(
        input.assignments.map((assignment) => assignment.female.id),
    );
    const invalidSelectionIds = new Set(
        input.invalidSelections.map((item) => item.selection.id),
    );
    const validFemales = input.selections.filter((selection) => {
        return (
            selection.gender === "female" &&
            !invalidSelectionIds.has(selection.id)
        );
    });

    return {
        nestCount: input.nestCount,
        strategy: input.strategy,
        selectedMales: input.selectedMales,
        assignments: input.assignments,
        placedSelections: input.selections.filter((selection) =>
            placedSelectionIds.has(selection.id),
        ),
        unusedSelections: input.selections.filter(
            (selection) => !placedSelectionIds.has(selection.id),
        ),
        unmatchedFemales: validFemales.filter(
            (selection) => !matchedFemaleIds.has(selection.id),
        ),
        invalidSelections: input.invalidSelections,
        allPairs: input.allPairs,
        eggCount: evaluatedPlan.eggCount,
        geneReadyCount: evaluatedPlan.geneReadyCount,
        shinyPairCount: evaluatedPlan.shinyPairCount,
        colorfulPairCount: evaluatedPlan.colorfulPairCount,
        totalScore: evaluatedPlan.totalScore,
        focusIncluded: evaluatedPlan.focusIncluded,
        focusSelectionIds: input.focusSelectionIds,
    };
}

function comparePairQuality(left: IIncubationPair, right: IIncubationPair) {
    return (
        right.pairTraitRank - left.pairTraitRank ||
        right.femaleTraitRank - left.femaleTraitRank ||
        right.maleTraitRank - left.maleTraitRank ||
        right.score - left.score ||
        right.sharedEggGroups.length - left.sharedEggGroups.length ||
        left.female.pet.localized.zh.name.localeCompare(
            right.female.pet.localized.zh.name,
            "zh-CN",
        ) ||
        left.male.pet.localized.zh.name.localeCompare(
            right.male.pet.localized.zh.name,
            "zh-CN",
        )
    );
}

function comparePlans(left: IEvaluatedPlan, right: IEvaluatedPlan) {
    return (
        right.eggCount - left.eggCount ||
        left.selectedMales.length - right.selectedMales.length ||
        right.geneReadyCount - left.geneReadyCount ||
        right.shinyPairCount - left.shinyPairCount ||
        right.colorfulPairCount - left.colorfulPairCount ||
        right.totalScore - left.totalScore ||
        left.selectedMales
            .map((male) => male.pet.localized.zh.name)
            .join("/")
            .localeCompare(
                right.selectedMales
                    .map((male) => male.pet.localized.zh.name)
                    .join("/"),
                "zh-CN",
            )
    );
}

function dedupePlans(plans: IEvaluatedPlan[]) {
    const planMap = new Map<string, IEvaluatedPlan>();

    for (const plan of plans) {
        const key = getPlanKey(plan);
        const existing = planMap.get(key);

        if (!existing || comparePlans(plan, existing) < 0) {
            planMap.set(key, plan);
        }
    }

    return [...planMap.values()];
}

function getPlanKey(plan: IEvaluatedPlan) {
    const maleIds = plan.selectedMales
        .map((selection) => selection.id)
        .sort()
        .join(",");
    const femaleIds = plan.assignments
        .map((assignment) => assignment.female.id)
        .sort()
        .join(",");

    return `${maleIds}|${femaleIds}`;
}

function matchesFocus(plan: IEvaluatedPlan, focusSelectionIds: string[]) {
    return !focusSelectionIds.length || plan.focusIncluded;
}

function isFocusIncluded(
    selectedMales: IIncubationSelection[],
    assignments: IIncubationAssignment[],
    focusSelectionIds: string[],
) {
    if (!focusSelectionIds.length) {
        return false;
    }

    const placedSelectionIds = new Set([
        ...selectedMales.map((selection) => selection.id),
        ...assignments.map((assignment) => assignment.female.id),
    ]);

    return focusSelectionIds.every((id) => placedSelectionIds.has(id));
}

function getMaleCoverageScore(
    male: IIncubationSelection,
    allPairs: IIncubationPair[],
) {
    return allPairs
        .filter((pair) => pair.male.id === male.id)
        .reduce((total, pair) => total + pair.score, 0);
}

function countBits(mask: number) {
    let value = mask;
    let count = 0;

    while (value) {
        value &= value - 1;
        count += 1;
    }

    return count;
}

<script setup lang="ts">
import {
    Clock3,
    Egg,
    RotateCcw,
    Ruler,
    Scale,
    Search,
    Sparkles,
} from "lucide-vue-next";
import type { LocationQuery, LocationQueryRaw } from "vue-router";
import FriendPortrait from "@/components/FriendPortrait.vue";
import type { IPets, IPetsBreedingVariant } from "@/lib/interface";
import {
    formatPetEggGroupSummary,
    isPetImplemented,
    matchesPetImplementationFilter,
    type PetImplementationFilter,
} from "@/lib/petImplementation";

interface IIncubateVariantEntry {
    key: string;
    id: number | null;
    petId: number | null;
    modelId: number | null;
    preciousEggType: number | null;
    sourcePetId: number;
    sourcePetName: string;
    heightLow: number | null;
    heightHigh: number | null;
    weightLow: number | null;
    weightHigh: number | null;
    hatchData: number | null;
}

interface IIncubateChainEntry {
    rootPet: IPets;
    members: IPets[];
    variants: IIncubateVariantEntry[];
}

interface IRangePetOption {
    pet: IPets;
    entry: IIncubateChainEntry;
}

interface IIncubateMatchResult {
    rootPet: IPets;
    sourcePetName: string;
    bestVariant: IIncubateVariantEntry;
    matchedMetricCount: number;
    score: number;
    memberCount: number;
}

const INITIAL_VISIBLE_MATCH_COUNT = 12;
const LOAD_MORE_MATCH_COUNT = 12;

const pets = ref<IPets[]>([]);
const isLoading = ref(false);
const errorMessage = ref("");
const heightInput = ref<string | number>("");
const weightInput = ref<string | number>("");
const implementationFilter = ref<PetImplementationFilter>("implemented");
const visibleMatchCount = ref(INITIAL_VISIBLE_MATCH_COUNT);
const rangePetPopoverOpen = ref(false);
const rangePetSearchQuery = ref("");
const selectedRangePetId = ref<number | null>(null);
const route = useRoute();
const router = useRouter();

let petsController: AbortController | null = null;

document.title = "孵蛋 - 洛克王国工具箱";

const heightValueMeters = computed(() => parsePositiveNumber(heightInput.value));
const heightValue = computed(() => {
    if (heightValueMeters.value === null) {
        return null;
    }

    return heightValueMeters.value * 100;
});
const weightValueKg = computed(() => parsePositiveNumber(weightInput.value));
const weightValue = computed(() => {
    if (weightValueKg.value === null) {
        return null;
    }

    return Math.round(weightValueKg.value * 1000);
});

const hasAnyInput = computed(() => {
    return heightValue.value !== null || weightValue.value !== null;
});

const hasInvalidInput = computed(() => {
    return (
        (hasInputValue(heightInput.value) && heightValue.value === null) ||
        (hasInputValue(weightInput.value) && weightValueKg.value === null)
    );
});

const invalidInputMessage = computed(() => {
    if (!hasInvalidInput.value) {
        return "";
    }

    return "请输入大于 0 的数字；身高单位为 m，体重单位为 kg。";
});

const chainEntries = computed(() => {
    if (!pets.value.length) {
        return [];
    }

    const petsById = new Map(pets.value.map((pet) => [pet.id, pet]));
    const rootIdCache = new Map<number, number>();
    const groups = new Map<
        number,
        IIncubateChainEntry & { variantKeys: Set<string> }
    >();

    const resolveRootId = (pet: IPets) => {
        const cached = rootIdCache.get(pet.id);

        if (cached) {
            return cached;
        }

        const visited: number[] = [];
        let current: IPets = pet;
        const seen = new Set<number>();

        while (current.evolves_from_id !== null) {
            if (seen.has(current.id)) {
                break;
            }

            seen.add(current.id);
            visited.push(current.id);

            const parent = petsById.get(current.evolves_from_id);

            if (!parent) {
                break;
            }

            current = parent;
        }

        rootIdCache.set(current.id, current.id);

        for (const visitedId of visited) {
            rootIdCache.set(visitedId, current.id);
        }

        return current.id;
    };

    for (const pet of pets.value) {
        const rootId = resolveRootId(pet);
        const rootPet = petsById.get(rootId) ?? pet;
        let entry = groups.get(rootId);

        if (!entry) {
            entry = {
                rootPet,
                members: [],
                variants: [],
                variantKeys: new Set<string>(),
            };
            groups.set(rootId, entry);
        }

        entry.members.push(pet);

        for (const variant of extractBreedingVariants(pet)) {
            const key = buildVariantKey(pet.id, variant);

            if (entry.variantKeys.has(key)) {
                continue;
            }

            entry.variantKeys.add(key);
            entry.variants.push({
                key,
                id: variant.id ?? null,
                petId: variant.pet_id ?? null,
                modelId: variant.model_id ?? null,
                preciousEggType: variant.precious_egg_type ?? null,
                sourcePetId: pet.id,
                sourcePetName: pet.localized.zh.name,
                heightLow: variant.height_low ?? null,
                heightHigh: variant.height_high ?? null,
                weightLow: variant.weight_low ?? null,
                weightHigh: variant.weight_high ?? null,
                hatchData: variant.hatch_data ?? null,
            });
        }
    }

    return [...groups.values()]
        .filter((entry) => entry.variants.length > 0)
        .map(({ variantKeys: _variantKeys, ...entry }) => entry)
        .sort((left, right) => {
            return left.rootPet.localized.zh.name.localeCompare(
                right.rootPet.localized.zh.name,
                "zh-CN",
            );
        });
});

const selectedRangePet = computed(() => {
    if (selectedRangePetId.value === null) {
        return null;
    }

    return pets.value.find((pet) => pet.id === selectedRangePetId.value) ?? null;
});

const selectedRangeEntry = computed(() => {
    if (!selectedRangePet.value) {
        return null;
    }

    return findChainEntryForPet(selectedRangePet.value);
});

const rangePetOptions = computed(() => {
    const normalizedQuery = rangePetSearchQuery.value
        .trim()
        .toLocaleLowerCase("zh-CN");

    const options = chainEntries.value.flatMap((entry) => {
        return entry.members.map((pet) => ({
            pet,
            entry,
        }));
    });

    return options.filter((option) => {
        if (
            !matchesPetImplementationFilter(
                option.pet,
                implementationFilter.value,
            )
        ) {
            return false;
        }

        if (!normalizedQuery) {
            return true;
        }

        const searchFields = [
            option.pet.localized.zh.name,
            option.pet.name,
            String(option.pet.id),
            option.entry.rootPet.localized.zh.name,
            option.entry.rootPet.name,
            String(option.entry.rootPet.id),
            getEggGroupSummary(option.entry.rootPet),
        ];

        return searchFields.some((field) => {
            return field.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
        });
    });
});

const selectedRangeVariant = computed(() => {
    const entry = selectedRangeEntry.value;

    if (!entry) {
        return null;
    }

    return selectPrimaryEggVariant(entry);
});

const matches = computed<IIncubateMatchResult[]>(() => {
    if (!hasAnyInput.value || hasInvalidInput.value) {
        return [];
    }

    return chainEntries.value
        .flatMap((entry) => {
            let bestMatch:
                | (IIncubateMatchResult & {
                      bestVariant: IIncubateVariantEntry;
                  })
                | null = null;

            for (const variant of entry.variants) {
                const evaluation = evaluateVariantMatch(variant);

                if (!evaluation) {
                    continue;
                }

                const candidate: IIncubateMatchResult = {
                    rootPet: entry.rootPet,
                    sourcePetName: variant.sourcePetName,
                    bestVariant: variant,
                    matchedMetricCount: evaluation.matchedMetricCount,
                    score: evaluation.score,
                    memberCount: entry.members.length,
                };

                if (
                    !bestMatch ||
                    candidate.score < bestMatch.score ||
                    (candidate.score === bestMatch.score &&
                        candidate.rootPet.localized.zh.name.localeCompare(
                            bestMatch.rootPet.localized.zh.name,
                            "zh-CN",
                        ) < 0)
                ) {
                    bestMatch = candidate;
                }
            }

            return bestMatch ? [bestMatch] : [];
        })
        .sort((left, right) => {
            if (left.score !== right.score) {
                return left.score - right.score;
            }

            if (left.matchedMetricCount !== right.matchedMetricCount) {
                return right.matchedMetricCount - left.matchedMetricCount;
            }

            return left.rootPet.localized.zh.name.localeCompare(
                right.rootPet.localized.zh.name,
                "zh-CN",
            );
        });
});

const filteredMatches = computed(() => {
    return matches.value.filter((result) => {
        return matchesPetImplementationFilter(
            result.rootPet,
            implementationFilter.value,
        );
    });
});

const topMatch = computed(() => {
    return filteredMatches.value[0] ?? null;
});

const visibleMatches = computed(() => {
    return filteredMatches.value.slice(0, visibleMatchCount.value);
});

const remainingMatchCount = computed(() => {
    return Math.max(
        filteredMatches.value.length - visibleMatches.value.length,
        0,
    );
});

const totalVariantCount = computed(() => {
    return chainEntries.value.reduce((total, entry) => {
        return total + entry.variants.length;
    }, 0);
});

const summaryCards = computed(() => {
    return [
        {
            label: "可反推进化链",
            value: String(chainEntries.value.length),
        },
        {
            label: "区间样本",
            value: String(totalVariantCount.value),
        },
        {
            label: "当前命中",
            value: String(filteredMatches.value.length),
        },
    ];
});

const activeInputSummary = computed(() => {
    return [
        {
            label: "身高",
            value:
                heightValueMeters.value === null
                    ? "未填"
                    : `${formatNumber(heightValueMeters.value, 3)} m`,
            icon: Ruler,
        },
        {
            label: "体重",
            value:
                weightValueKg.value === null
                    ? "未填"
                    : `${formatNumber(weightValueKg.value)} kg`,
            icon: Scale,
        },
    ];
});

const filterDescription = computed(() => {
    if (!hasAnyInput.value) {
        return "输入至少一项后开始反推，身高与体重同时输入会更准。";
    }

    if (heightValue.value !== null && weightValueKg.value !== null) {
        return "当前按身高 + 体重双维度同时命中进行筛选。";
    }

    return "当前仅按单维度筛选，候选会相对更宽。";
});

const emptyStateTitle = computed(() => {
    if (matches.value.length > 0 && filteredMatches.value.length === 0) {
        return "当前命中的都是未实装精灵";
    }

    return "没有命中的孵化区间";
});

const emptyStateDescription = computed(() => {
    if (matches.value.length > 0 && filteredMatches.value.length === 0) {
        return "当前输入已经命中公开区间，但这些结果都属于未实装精灵；孵蛋列表现在只展示已实装精灵。";
    }

    return "当前输入值没有命中公开数据里的身高或体重区间，可以尝试放宽其中一个维度，或检查单位是否为 m / kg。";
});

watch(
    () => route.query,
    (query) => {
        const nextState = parseRouteQuery(query);

        if (normalizeInputValue(heightInput.value) !== nextState.height) {
            heightInput.value = nextState.height;
        }

        if (normalizeInputValue(weightInput.value) !== nextState.weight) {
            weightInput.value = nextState.weight;
        }
    },
    { immediate: true },
);

watch(
    [heightInput, weightInput],
    ([nextHeight, nextWeight]) => {
        const nextQuery = buildRouteQuery({
            height: normalizeInputValue(nextHeight),
            weight: normalizeInputValue(nextWeight),
        });
        const currentQuery = buildRouteQuery(parseRouteQuery(route.query));

        if (serializeQuery(nextQuery) === serializeQuery(currentQuery)) {
            return;
        }

        void router.replace({ query: nextQuery });
    },
    { deep: false },
);

watch(
    filteredMatches,
    (nextMatches) => {
        visibleMatchCount.value = Math.min(
            INITIAL_VISIBLE_MATCH_COUNT,
            nextMatches.length,
        );
    },
    { immediate: true },
);

onMounted(() => {
    void getPets();
});

onBeforeUnmount(() => {
    petsController?.abort();
});

async function getPets() {
    petsController?.abort();
    petsController = new AbortController();
    isLoading.value = true;
    errorMessage.value = "";

    try {
        const response = await fetch("/data/Pets.json", {
            signal: petsController.signal,
        });

        if (!response.ok) {
            throw new Error(`请求失败: ${response.status}`);
        }

        pets.value = (await response.json()) as IPets[];
    } catch (error) {
        if (petsController.signal.aborted) {
            return;
        }

        const message = error instanceof Error ? error.message : "加载失败";
        errorMessage.value = message;
        pets.value = [];
    } finally {
        if (!petsController.signal.aborted) {
            isLoading.value = false;
        }
    }
}

function extractBreedingVariants(pet: IPets) {
    const breeding = pet.breeding;

    if (!breeding) {
        return [];
    }

    const variants = breeding.variants?.length ? breeding.variants : [breeding];

    return variants.filter((variant) => {
        return (
            variant.height_low !== null ||
            variant.height_high !== null ||
            variant.weight_low !== null ||
            variant.weight_high !== null
        );
    });
}

function buildVariantKey(petId: number, variant: IPetsBreedingVariant) {
    return [
        petId,
        variant.id ?? "na",
        variant.height_low ?? "na",
        variant.height_high ?? "na",
        variant.weight_low ?? "na",
        variant.weight_high ?? "na",
        variant.hatch_data ?? "na",
    ].join(":");
}

function evaluateVariantMatch(variant: IIncubateVariantEntry) {
    let score = 0;
    let matchedMetricCount = 0;

    if (heightValue.value !== null) {
        const heightMatch = evaluateMetric(
            heightValue.value,
            variant.heightLow,
            variant.heightHigh,
        );

        if (!heightMatch) {
            return null;
        }

        score += heightMatch;
        matchedMetricCount += 1;
    }

    if (weightValue.value !== null) {
        const weightMatch = evaluateMetric(
            weightValue.value,
            variant.weightLow,
            variant.weightHigh,
        );

        if (!weightMatch) {
            return null;
        }

        score += weightMatch;
        matchedMetricCount += 1;
    }

    if (matchedMetricCount === 0) {
        return null;
    }

    return {
        score,
        matchedMetricCount,
    };
}

function evaluateMetric(
    value: number,
    low: number | null,
    high: number | null,
) {
    if (low === null && high === null) {
        return null;
    }

    const min = Math.min(low ?? high ?? value, high ?? low ?? value);
    const max = Math.max(low ?? high ?? value, high ?? low ?? value);

    if (value < min || value > max) {
        return null;
    }

    const center = (min + max) / 2;
    const span = Math.max(max - min, 1);
    const centerPenalty = Math.abs(value - center) / Math.max(span / 2, 1);
    const spanPenalty = (span / Math.max(center, 1)) * 0.35;

    return centerPenalty + spanPenalty;
}

function parsePositiveNumber(rawValue: string | number | null | undefined) {
    const trimmedValue = normalizeInputValue(rawValue);

    if (!trimmedValue) {
        return null;
    }

    const parsed = Number(trimmedValue);

    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }

    return parsed;
}

function normalizeInputValue(rawValue: string | number | null | undefined) {
    if (typeof rawValue === "number") {
        return Number.isFinite(rawValue) ? String(rawValue).trim() : "";
    }

    if (typeof rawValue === "string") {
        return rawValue.trim();
    }

    return "";
}

function hasInputValue(rawValue: string | number | null | undefined) {
    return normalizeInputValue(rawValue).length > 0;
}

function getQueryValue(value: LocationQuery[string] | undefined) {
    return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function parseRouteQuery(query: LocationQuery) {
    return {
        height: getQueryValue(query.height).trim(),
        weight: getQueryValue(query.weight).trim(),
    };
}

function buildRouteQuery(state: { height: string; weight: string }) {
    const query: LocationQueryRaw = {};

    if (state.height) {
        query.height = state.height;
    }

    if (state.weight) {
        query.weight = state.weight;
    }

    return query;
}

function serializeQuery(query: LocationQueryRaw) {
    return JSON.stringify(
        Object.entries(query).sort(([leftKey], [rightKey]) =>
            leftKey.localeCompare(rightKey),
        ),
    );
}

function resetInputs() {
    heightInput.value = "";
    weightInput.value = "";
}

function selectRangePet(petId: number) {
    selectedRangePetId.value = petId;
    rangePetPopoverOpen.value = false;
    rangePetSearchQuery.value = "";
}

function clearRangePet() {
    selectedRangePetId.value = null;
}

function findChainEntryForPet(pet: IPets) {
    return (
        chainEntries.value.find((entry) => {
            return entry.members.some((member) => member.id === pet.id);
        }) ?? null
    );
}

function selectPrimaryEggVariant(entry: IIncubateChainEntry) {
    const rootEggId = entry.rootPet.id * 1000 + 1;
    const rootPrefix = String(entry.rootPet.id);
    const sortedVariants = [...entry.variants].sort(compareEggVariants);

    return (
        sortedVariants.find((variant) => variant.id === rootEggId) ??
        sortedVariants.find((variant) => variant.petId === rootEggId) ??
        sortedVariants.find((variant) => variant.modelId === rootEggId) ??
        sortedVariants.find((variant) =>
            hasBaseEggPrefix(variant, rootPrefix),
        ) ??
        sortedVariants.find((variant) => variant.preciousEggType === null) ??
        sortedVariants[0] ??
        null
    );
}

function hasBaseEggPrefix(variant: IIncubateVariantEntry, rootPrefix: string) {
    return [variant.id, variant.petId, variant.modelId]
        .filter((value): value is number => value !== null)
        .some((value) => String(value).startsWith(rootPrefix));
}

function compareEggVariants(
    left: IIncubateVariantEntry,
    right: IIncubateVariantEntry,
) {
    return (
        getEggVariantSortValue(left) - getEggVariantSortValue(right) ||
        left.sourcePetName.localeCompare(right.sourcePetName, "zh-CN") ||
        (left.heightLow ?? 0) - (right.heightLow ?? 0) ||
        (left.weightLow ?? 0) - (right.weightLow ?? 0)
    );
}

function getEggVariantSortValue(variant: IIncubateVariantEntry) {
    return (
        variant.id ??
        variant.petId ??
        variant.modelId ??
        Number.MAX_SAFE_INTEGER
    );
}

function loadMoreMatches() {
    visibleMatchCount.value = Math.min(
        visibleMatchCount.value + LOAD_MORE_MATCH_COUNT,
        filteredMatches.value.length,
    );
}

function formatDuration(seconds: number | null) {
    if (seconds === null || seconds <= 0) {
        return "暂无数据";
    }

    if (seconds % 86400 === 0) {
        return `${seconds / 86400} 天`;
    }

    const hours = seconds / 3600;

    if (Number.isInteger(hours)) {
        return `${hours} 小时`;
    }

    return `${hours.toFixed(1)} 小时`;
}

function formatRange(
    low: number | null,
    high: number | null,
    unit: string,
    fractionDigits?: number,
) {
    if (low === null && high === null) {
        return "暂无数据";
    }

    if (low !== null && high !== null) {
        if (low === high) {
            return `${formatNumber(low, fractionDigits)}${unit}`;
        }

        return `${formatNumber(low, fractionDigits)}-${formatNumber(
            high,
            fractionDigits,
        )}${unit}`;
    }

    return `${formatNumber(low ?? high ?? 0, fractionDigits)}${unit}`;
}

function formatNumber(value: number, fractionDigits?: number) {
    if (fractionDigits !== undefined) {
        return new Intl.NumberFormat("zh-CN", {
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits,
        }).format(value);
    }

    return new Intl.NumberFormat("zh-CN", {
        maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
}

function normalizeWeight(value: number | null) {
    if (value === null) {
        return null;
    }

    return value / 1000;
}

function normalizeHeight(value: number | null) {
    if (value === null) {
        return null;
    }

    return value / 100;
}

function getWeightRangeLabel(result: IIncubateMatchResult) {
    return formatRange(
        normalizeWeight(result.bestVariant.weightLow),
        normalizeWeight(result.bestVariant.weightHigh),
        "kg",
        3,
    );
}

function getHeightRangeLabel(result: IIncubateMatchResult) {
    return formatRange(
        normalizeHeight(result.bestVariant.heightLow),
        normalizeHeight(result.bestVariant.heightHigh),
        "m",
        3,
    );
}

function getVariantWeightRangeLabel(variant: IIncubateVariantEntry) {
    return formatRange(
        normalizeWeight(variant.weightLow),
        normalizeWeight(variant.weightHigh),
        "kg",
        3,
    );
}

function getVariantHeightRangeLabel(variant: IIncubateVariantEntry) {
    return formatRange(
        normalizeHeight(variant.heightLow),
        normalizeHeight(variant.heightHigh),
        "m",
        3,
    );
}

function getEggGroupSummary(pet: IPets) {
    return formatPetEggGroupSummary(pet);
}

function getTypeLabel(pet: IPets) {
    return pet.sub_type
        ? `${pet.main_type.localized.zh} / ${pet.sub_type.localized.zh}`
        : pet.main_type.localized.zh;
}

function getMatchSourceLabel(result: IIncubateMatchResult) {
    if (result.rootPet.localized.zh.name === result.sourcePetName) {
        return "区间直接命中最低阶段";
    }

    return `区间命中 ${result.sourcePetName}，结果回落到最低阶段`;
}
</script>

<template>
    <section class="space-y-3">
        <Card class="relative overflow-hidden border-border">
            <CardContent class="relative">
                <div
                    class="grid gap-3 xl:grid-cols-[1.1fr_0.9fr] xl:items-center"
                >
                    <div class="max-w-3xl space-y-4">
                        <div class="space-y-3">
                            <h1
                                class="text-3xl font-semibold tracking-tight text-foreground md:text-5xl"
                            >
                                孵蛋
                            </h1>
                        </div>
                    </div>

                    <div class="grid gap-3 sm:grid-cols-3">
                        <div
                            v-for="item in summaryCards"
                            :key="item.label"
                            class="rounded-[10px] border border-border bg-card p-4"
                        >
                            <div
                                class="text-xs uppercase tracking-[0.24em] text-foreground"
                            >
                                {{ item.label }}
                            </div>
                            <div
                                class="mt-3 text-2xl font-semibold text-foreground"
                            >
                                {{ item.value }}
                            </div>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>

        <div class="grid gap-3 xl:grid-cols-[340px_minmax(0,1fr)]">
            <Card
                class="border-border bg-card py-0 shadow-md xl:sticky xl:top-4 xl:self-start"
            >
                <CardContent class="space-y-5 px-5 py-4">
                    <div class="space-y-2">
                        <div class="flex items-center gap-2 text-foreground">
                            <Search class="h-4 w-4 text-foreground" />
                            <h2 class="text-lg font-semibold">输入观察值</h2>
                        </div>
                    </div>

                    <div class="grid gap-4">
                        <label class="space-y-2">
                            <span
                                class="flex items-center gap-2 text-sm text-foreground"
                            >
                                <Ruler class="h-4 w-4 text-sky-200" />
                                身高
                            </span>
                            <div class="relative">
                                <Input
                                    v-model="heightInput"
                                    type="number"
                                    min="0"
                                    step="0.001"
                                    placeholder="例如 0.230"
                                    class="border-border bg-slate-950/70 pr-12 text-foreground"
                                />
                                <span
                                    class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-foreground"
                                >
                                    m
                                </span>
                            </div>
                        </label>

                        <label class="space-y-2">
                            <span
                                class="flex items-center gap-2 text-sm text-foreground"
                            >
                                <Scale class="h-4 w-4 text-emerald-200" />
                                体重
                            </span>
                            <div class="relative">
                                <Input
                                    v-model="weightInput"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder="例如 2.35"
                                    class="border-border bg-slate-950/70 pr-12 text-foreground"
                                />
                                <span
                                    class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-foreground"
                                >
                                    kg
                                </span>
                            </div>
                        </label>
                    </div>

                    <div
                        v-if="invalidInputMessage"
                        class="rounded-[10px] border border-red-400/20 bg-red-500/8 px-4 py-3 text-sm leading-6 text-red-100"
                    >
                        {{ invalidInputMessage }}
                    </div>

                    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                        <div
                            v-for="item in activeInputSummary"
                            :key="item.label"
                            class="rounded-[10px] border border-border bg-muted p-4"
                        >
                            <div
                                class="flex items-center gap-2 text-xs tracking-[0.2em] text-foreground uppercase"
                            >
                                <component
                                    :is="item.icon"
                                    class="h-3.5 w-3.5"
                                />
                                {{ item.label }}
                            </div>
                            <div
                                class="mt-3 text-lg font-semibold text-foreground"
                            >
                                {{ item.value }}
                            </div>
                        </div>
                    </div>

                    <Separator class="bg-white/10" />

                    <Button
                        variant="outline"
                        class="w-full border-border bg-muted text-foreground hover:bg-accent"
                        @click="resetInputs"
                    >
                        <RotateCcw class="h-4 w-4" />
                        清空输入
                    </Button>

                    <Separator class="bg-white/10" />

                    <div class="space-y-4">
                        <div class="flex items-center gap-2 text-foreground">
                            <Egg class="h-4 w-4 text-foreground" />
                            <h2 class="text-lg font-semibold">
                                已知精灵查区间
                            </h2>
                        </div>

                        <Popover v-model:open="rangePetPopoverOpen">
                            <PopoverTrigger as-child>
                                <Button
                                    variant="outline"
                                    class="h-auto w-full justify-between rounded-[10px] border-border bg-muted px-4 py-3 text-left text-foreground hover:bg-accent"
                                >
                                    <div class="min-w-0">
                                        <p class="text-xs text-foreground">
                                            精灵
                                        </p>
                                        <p
                                            class="mt-1 truncate text-sm font-medium text-foreground"
                                        >
                                            {{
                                                selectedRangePet
                                                    ?.localized.zh.name ??
                                                "选择精灵"
                                            }}
                                        </p>
                                    </div>
                                    <Search
                                        class="h-4 w-4 shrink-0 text-foreground"
                                    />
                                </Button>
                            </PopoverTrigger>

                            <PopoverContent
                                v-if="rangePetPopoverOpen"
                                align="start"
                                class="w-[min(30rem,calc(100vw-2rem))] border-border bg-slate-950/95 p-0 text-foreground"
                            >
                                <div class="border-b border-border p-3">
                                    <div class="relative">
                                        <Search
                                            class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-foreground"
                                        />
                                        <Input
                                            v-model="rangePetSearchQuery"
                                            placeholder="搜索名称、编号、蛋组"
                                            class="h-11 rounded-[10px] border-border bg-card pl-9 text-foreground placeholder:text-foreground"
                                        />
                                    </div>
                                </div>

                                <div
                                    v-if="!rangePetOptions.length"
                                    class="px-4 py-8 text-sm text-foreground"
                                >
                                    没有匹配的精灵蛋。
                                </div>

                                <div
                                    v-else
                                    class="max-h-96 overflow-y-auto px-2 py-2"
                                >
                                    <button
                                        v-for="option in rangePetOptions"
                                        :key="option.pet.id"
                                        type="button"
                                        class="mb-2 flex w-full items-center gap-3 rounded-[10px] border border-transparent bg-white/4 px-3 py-3 text-left text-foreground transition-colors hover:bg-muted"
                                        @click="
                                            selectRangePet(option.pet.id)
                                        "
                                    >
                                        <FriendPortrait
                                            :name="option.pet.name"
                                            :alt="
                                                option.pet.localized.zh.name
                                            "
                                            class="h-10 w-12 shrink-0 rounded-[10px] border-border"
                                            img-class="object-contain p-1"
                                        />
                                        <div class="min-w-0 flex-1 space-y-1">
                                            <div
                                                class="flex items-center gap-2"
                                            >
                                                <p
                                                    class="truncate font-medium text-foreground"
                                                >
                                                    {{
                                                        option.pet.localized.zh
                                                            .name
                                                    }}
                                                </p>
                                                <Badge
                                                    v-if="
                                                        !isPetImplemented(
                                                            option.pet,
                                                        )
                                                    "
                                                    variant="outline"
                                                    class="rounded-[10px] border-border/20 bg-card px-1.5 py-0 text-[10px] text-foreground"
                                                >
                                                    未实装
                                                </Badge>
                                            </div>
                                            <p
                                                class="truncate text-xs text-foreground"
                                            >
                                                {{
                                                    getEggGroupSummary(
                                                        option.entry.rootPet,
                                                    )
                                                }}
                                                · 所属蛋
                                                {{
                                                    option.entry.rootPet
                                                        .localized.zh.name
                                                }}
                                            </p>
                                        </div>
                                    </button>
                                </div>
                            </PopoverContent>
                        </Popover>

                        <div
                            v-if="selectedRangeEntry"
                            class="rounded-[10px] border border-border bg-muted p-3"
                        >
                            <div class="flex items-center gap-3">
                                <FriendPortrait
                                    :name="selectedRangePet?.name ?? selectedRangeEntry.rootPet.name"
                                    :alt="
                                        selectedRangePet?.localized.zh.name ??
                                        selectedRangeEntry.rootPet.localized.zh
                                            .name
                                    "
                                    class="h-12 w-14 shrink-0 rounded-[10px] border-border"
                                    img-class="object-contain p-1"
                                />
                                <div class="min-w-0 flex-1">
                                    <p
                                        class="truncate font-medium text-foreground"
                                    >
                                        {{
                                            selectedRangePet?.localized.zh
                                                .name ??
                                            selectedRangeEntry.rootPet.localized
                                                .zh.name
                                        }}
                                    </p>
                                    <p class="mt-1 truncate text-xs text-foreground">
                                        所属蛋：{{
                                            selectedRangeEntry.rootPet.localized
                                                .zh.name
                                        }}
                                        ·
                                        {{
                                            getEggGroupSummary(
                                                selectedRangeEntry.rootPet,
                                            )
                                        }}
                                    </p>
                                </div>
                            </div>
                            <Button
                                variant="ghost"
                                class="mt-3 w-full rounded-[10px] text-foreground hover:bg-accent"
                                @click="clearRangePet"
                            >
                                清空选择
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div class="space-y-3">
                <Card
                    v-if="selectedRangeEntry"
                    class="border-border bg-card py-0 shadow-md"
                >
                    <CardContent class="space-y-4 px-4 py-4">
                        <div
                            class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
                        >
                            <div class="flex min-w-0 items-center gap-4">
                                <FriendPortrait
                                    :name="selectedRangePet?.name ?? selectedRangeEntry.rootPet.name"
                                    :alt="
                                        selectedRangePet?.localized.zh.name ??
                                        selectedRangeEntry.rootPet.localized.zh
                                            .name
                                    "
                                    class="h-20 w-20 shrink-0 rounded-[10px] border-border"
                                    img-class="object-contain p-2"
                                />
                                <div class="min-w-0">
                                    <p
                                        class="text-xs uppercase tracking-[0.2em] text-foreground"
                                    >
                                        精灵蛋区间
                                    </p>
                                    <h2
                                        class="mt-2 truncate text-2xl font-semibold text-foreground"
                                    >
                                        {{
                                            selectedRangePet?.localized.zh
                                                .name ??
                                            selectedRangeEntry.rootPet.localized
                                                .zh.name
                                        }}
                                    </h2>
                                    <p class="mt-2 text-sm text-foreground">
                                        所属精灵蛋：{{
                                            selectedRangeEntry.rootPet.localized
                                                .zh.name
                                        }}
                                        ·
                                        {{
                                            getEggGroupSummary(
                                                selectedRangeEntry.rootPet,
                                            )
                                        }}
                                        · 进化链成员
                                        {{ selectedRangeEntry.members.length }}
                                        个
                                    </p>
                                </div>
                            </div>
                            <Button
                                as-child
                                variant="outline"
                                class="border-border bg-muted text-foreground hover:bg-accent"
                            >
                                <RouterLink
                                    :to="`/pets/${selectedRangeEntry.rootPet.id}`"
                                >
                                    查看图鉴
                                </RouterLink>
                            </Button>
                        </div>

                        <div
                            v-if="selectedRangeVariant"
                            class="rounded-[10px] border border-border bg-muted p-4"
                        >
                            <div class="flex items-start justify-between gap-3">
                                <div class="min-w-0">
                                    <p
                                        class="truncate text-sm font-medium text-foreground"
                                    >
                                        {{ selectedRangeVariant.sourcePetName }}
                                    </p>
                                    <p class="mt-1 text-xs text-foreground">
                                        孵化时长：{{
                                            formatDuration(
                                                selectedRangeVariant.hatchData,
                                            )
                                        }}
                                    </p>
                                </div>
                                <Badge
                                    variant="outline"
                                    class="shrink-0 border-border text-foreground"
                                >
                                    主区间
                                </Badge>
                            </div>

                            <div class="mt-4 grid gap-3 sm:grid-cols-2">
                                <div
                                    class="rounded-[10px] border border-border bg-card p-3"
                                >
                                    <div
                                        class="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-foreground"
                                    >
                                        <Ruler class="h-3.5 w-3.5" />
                                        身高
                                    </div>
                                    <div
                                        class="mt-2 text-sm font-semibold text-foreground"
                                    >
                                        {{
                                            getVariantHeightRangeLabel(
                                                selectedRangeVariant,
                                            )
                                        }}
                                    </div>
                                </div>

                                <div
                                    class="rounded-[10px] border border-border bg-card p-3"
                                >
                                    <div
                                        class="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-foreground"
                                    >
                                        <Scale class="h-3.5 w-3.5" />
                                        体重
                                    </div>
                                    <div
                                        class="mt-2 text-sm font-semibold text-foreground"
                                    >
                                        {{
                                            getVariantWeightRangeLabel(
                                                selectedRangeVariant,
                                            )
                                        }}
                                    </div>
                                </div>
                            </div>
                        </div>

                    </CardContent>
                </Card>

                <Card
                    v-if="isLoading"
                    class="border-border bg-card py-0 shadow-md"
                >
                    <CardContent class="px-4 py-10 text-center text-foreground">
                        正在加载孵化区间数据...
                    </CardContent>
                </Card>

                <Card
                    v-else-if="errorMessage"
                    class="border-red-400/20 bg-red-500/8 py-0 shadow-md"
                >
                    <CardContent class="px-4 py-10 text-center text-red-100">
                        数据加载失败：{{ errorMessage }}
                    </CardContent>
                </Card>

                <Card
                    v-else-if="!hasAnyInput"
                    class="border-border bg-card py-0 shadow-md"
                >
                    <CardContent class="px-4 py-6 text-center">
                        <div
                            class="mx-auto flex h-14 w-14 items-center justify-center rounded-[10px] border border-border bg-muted text-foreground"
                        >
                            <Search class="h-6 w-6" />
                        </div>
                        <h2 class="mt-5 text-2xl font-semibold text-foreground">
                            先给我一组观察值
                        </h2>
                        <p
                            class="mx-auto mt-3 max-w-xl text-sm leading-7 text-foreground"
                        >
                            例如输入身高 0.230 m、体重 2.35
                            kg，就能开始按孵化区间反推最低阶段精灵。
                        </p>
                    </CardContent>
                </Card>

                <Card
                    v-else-if="!filteredMatches.length"
                    class="border-border bg-card py-0 shadow-md"
                >
                    <CardContent class="px-4 py-6 text-center">
                        <div
                            class="mx-auto flex h-14 w-14 items-center justify-center rounded-[10px] border border-border bg-muted text-foreground"
                        >
                            <Sparkles class="h-6 w-6" />
                        </div>
                        <h2 class="mt-5 text-2xl font-semibold text-foreground">
                            {{ emptyStateTitle }}
                        </h2>
                        <p
                            class="mx-auto mt-3 max-w-xl text-sm leading-7 text-foreground"
                        >
                            {{ emptyStateDescription }}
                        </p>
                    </CardContent>
                </Card>

                <template v-else>
                    <Card v-if="topMatch" class="overflow-hidden border-border">
                        <CardContent>
                            <div
                                class="grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-center"
                            >
                                <FriendPortrait
                                    :name="topMatch.rootPet.name"
                                    :alt="topMatch.rootPet.localized.zh.name"
                                    class="aspect-4/3 w-full rounded-[10px] border-border"
                                    img-class="object-contain p-1"
                                />

                                <div class="space-y-5">
                                    <div class="space-y-3">
                                        <div class="flex flex-wrap gap-2">
                                            <Badge
                                                class="bg-card hover:bg-accent text-foreground"
                                            >
                                                <Sparkles class="h-3.5 w-3.5" />
                                                最贴合结果
                                            </Badge>
                                            <Badge
                                                variant="outline"
                                                class="border-border text-foreground"
                                            >
                                                {{
                                                    topMatch.matchedMetricCount ===
                                                    2
                                                        ? "双维度命中"
                                                        : "单维度命中"
                                                }}
                                            </Badge>
                                            <Badge
                                                v-if="
                                                    !isPetImplemented(
                                                        topMatch.rootPet,
                                                    )
                                                "
                                                variant="outline"
                                                class="border-border/20 bg-card hover:bg-accent/10 text-foreground"
                                            >
                                                未实装
                                            </Badge>
                                        </div>

                                        <div>
                                            <h2
                                                class="text-2xl font-semibold text-foreground md:text-3xl"
                                            >
                                                {{
                                                    topMatch.rootPet.localized
                                                        .zh.name
                                                }}
                                            </h2>
                                            <p
                                                class="mt-2 text-sm leading-6 text-foreground md:text-base"
                                            >
                                                {{
                                                    getMatchSourceLabel(
                                                        topMatch,
                                                    )
                                                }}
                                            </p>
                                        </div>

                                        <div class="flex flex-wrap gap-2">
                                            <Badge variant="secondary">
                                                {{
                                                    getTypeLabel(
                                                        topMatch.rootPet,
                                                    )
                                                }}
                                            </Badge>
                                            <Badge
                                                variant="outline"
                                                class="border-border text-foreground"
                                            >
                                                {{
                                                    getEggGroupSummary(
                                                        topMatch.rootPet,
                                                    )
                                                }}
                                            </Badge>
                                            <Badge
                                                variant="outline"
                                                class="border-border text-foreground"
                                            >
                                                进化链成员
                                                {{ topMatch.memberCount }} 个
                                            </Badge>
                                        </div>
                                    </div>

                                    <div
                                        class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
                                    >
                                        <div
                                            class="rounded-[10px] border border-border bg-card p-4"
                                        >
                                            <div
                                                class="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-foreground"
                                            >
                                                <Ruler class="h-3.5 w-3.5" />
                                                身高区间
                                            </div>
                                            <div
                                                class="mt-3 text-lg font-semibold text-foreground"
                                            >
                                                {{
                                                    getHeightRangeLabel(
                                                        topMatch,
                                                    )
                                                }}
                                            </div>
                                        </div>

                                        <div
                                            class="rounded-[10px] border border-border bg-card p-4"
                                        >
                                            <div
                                                class="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-foreground"
                                            >
                                                <Scale class="h-3.5 w-3.5" />
                                                体重区间
                                            </div>
                                            <div
                                                class="mt-3 text-lg font-semibold text-foreground"
                                            >
                                                {{
                                                    getWeightRangeLabel(
                                                        topMatch,
                                                    )
                                                }}
                                            </div>
                                        </div>

                                        <div
                                            class="rounded-[10px] border border-border bg-card p-4"
                                        >
                                            <div
                                                class="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-foreground"
                                            >
                                                <Clock3 class="h-3.5 w-3.5" />
                                                孵化时长
                                            </div>
                                            <div
                                                class="mt-3 text-lg font-semibold text-foreground"
                                            >
                                                {{
                                                    formatDuration(
                                                        topMatch.bestVariant
                                                            .hatchData,
                                                    )
                                                }}
                                            </div>
                                        </div>

                                        <div
                                            class="rounded-[10px] border border-border bg-card p-4"
                                        >
                                            <div
                                                class="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-foreground"
                                            >
                                                <Egg class="h-3.5 w-3.5" />
                                                命中来源
                                            </div>
                                            <div
                                                class="mt-3 text-lg font-semibold text-foreground"
                                            >
                                                {{ topMatch.sourcePetName }}
                                            </div>
                                        </div>
                                    </div>

                                    <div class="flex flex-wrap gap-3">
                                        <Button
                                            as-child
                                            class="bg-card hover:bg-accent text-foreground hover:bg-card hover:bg-accent"
                                        >
                                            <RouterLink
                                                :to="`/pets/${topMatch.rootPet.id}`"
                                            >
                                                查看图鉴
                                            </RouterLink>
                                        </Button>
                                        <Button
                                            variant="outline"
                                            class="border-border bg-muted text-foreground hover:bg-accent"
                                            @click="resetInputs"
                                        >
                                            重新输入
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Tabs default-value="result" class="w-full">
                        <TabsList
                            class="grid w-full grid-cols-2 bg-muted p-1 rounded-[10px]"
                        >
                            <TabsTrigger value="result">推荐候选</TabsTrigger>
                            <TabsTrigger value="rule">匹配规则</TabsTrigger>
                        </TabsList>

                        <TabsContent value="result" class="mt-4">
                            <div
                                class="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
                            >
                                <Card
                                    v-for="result in visibleMatches"
                                    :key="result.rootPet.id"
                                    class="border-border bg-card py-0 shadow-md transition-transform hover:-translate-y-1"
                                >
                                    <CardContent class="space-y-4 px-5 py-5">
                                        <div class="flex items-start gap-4">
                                            <FriendPortrait
                                                :name="result.rootPet.name"
                                                :alt="
                                                    result.rootPet.localized.zh
                                                        .name
                                                "
                                                class="h-20 w-20 shrink-0 rounded-[10px] border-border"
                                                img-class="object-contain p-2"
                                            />

                                            <div
                                                class="min-w-0 flex-1 space-y-2"
                                            >
                                                <div>
                                                    <h3
                                                        class="truncate text-xl font-semibold text-foreground"
                                                    >
                                                        {{
                                                            result.rootPet
                                                                .localized.zh
                                                                .name
                                                        }}
                                                    </h3>
                                                    <p
                                                        class="text-sm text-foreground"
                                                    >
                                                        {{
                                                            getTypeLabel(
                                                                result.rootPet,
                                                            )
                                                        }}
                                                    </p>
                                                </div>

                                                <div
                                                    class="flex flex-wrap gap-2"
                                                >
                                                    <Badge variant="secondary">
                                                        {{
                                                            result.matchedMetricCount ===
                                                            2
                                                                ? "双命中"
                                                                : "单命中"
                                                        }}
                                                    </Badge>
                                                    <Badge
                                                        v-if="
                                                            !isPetImplemented(
                                                                result.rootPet,
                                                            )
                                                        "
                                                        variant="outline"
                                                        class="border-border/20 bg-card hover:bg-accent/10 text-foreground"
                                                    >
                                                        未实装
                                                    </Badge>
                                                    <Badge
                                                        variant="outline"
                                                        class="border-border text-foreground"
                                                    >
                                                        {{
                                                            result.sourcePetName
                                                        }}
                                                    </Badge>
                                                </div>
                                            </div>
                                        </div>

                                        <div class="grid gap-3 sm:grid-cols-2">
                                            <div
                                                class="rounded-[10px] border border-border bg-muted p-3"
                                            >
                                                <div
                                                    class="text-xs uppercase tracking-[0.2em] text-foreground"
                                                >
                                                    身高
                                                </div>
                                                <div
                                                    class="mt-2 text-sm font-medium text-foreground"
                                                >
                                                    {{
                                                        getHeightRangeLabel(
                                                            result,
                                                        )
                                                    }}
                                                </div>
                                            </div>

                                            <div
                                                class="rounded-[10px] border border-border bg-muted p-3"
                                            >
                                                <div
                                                    class="text-xs uppercase tracking-[0.2em] text-foreground"
                                                >
                                                    体重
                                                </div>
                                                <div
                                                    class="mt-2 text-sm font-medium text-foreground"
                                                >
                                                    {{
                                                        getWeightRangeLabel(
                                                            result,
                                                        )
                                                    }}
                                                </div>
                                            </div>
                                        </div>

                                        <div
                                            class="space-y-2 text-sm leading-6 text-foreground"
                                        >
                                            <p>
                                                {{
                                                    getMatchSourceLabel(result)
                                                }}
                                            </p>
                                            <p>
                                                孵化时长：{{
                                                    formatDuration(
                                                        result.bestVariant
                                                            .hatchData,
                                                    )
                                                }}
                                            </p>
                                        </div>

                                        <Button
                                            as-child
                                            variant="outline"
                                            class="w-full border-border bg-muted text-foreground hover:bg-accent"
                                        >
                                            <RouterLink
                                                :to="`/pets/${result.rootPet.id}`"
                                            >
                                                查看
                                                {{
                                                    result.rootPet.localized.zh
                                                        .name
                                                }}
                                            </RouterLink>
                                        </Button>
                                    </CardContent>
                                </Card>
                            </div>

                            <div
                                v-if="remainingMatchCount > 0"
                                class="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between"
                            >
                                <p class="text-sm text-foreground">
                                    还有
                                    {{ remainingMatchCount }}
                                    个命中结果未展开，当前已展示
                                    {{ visibleMatches.length }}
                                    个候选。
                                </p>
                                <Button
                                    variant="outline"
                                    class="border-border bg-muted text-foreground hover:bg-accent"
                                    @click="loadMoreMatches"
                                >
                                    继续加载候选
                                </Button>
                            </div>
                        </TabsContent>

                        <TabsContent value="rule" class="mt-4">
                            <Card class="border-border bg-card py-0 shadow-md">
                                <CardContent class="space-y-5 px-4 py-4">
                                    <div class="space-y-2">
                                        <h3
                                            class="text-xl font-semibold text-foreground"
                                        >
                                            当前页面如何反推
                                        </h3>
                                        <p
                                            class="text-sm leading-7 text-foreground"
                                        >
                                            数据来自公开精灵表中的 breeding 与
                                            variants
                                            区间信息，页面不会伪造额外范围。
                                        </p>
                                    </div>

                                    <div class="grid gap-3 md:grid-cols-3">
                                        <div
                                            class="rounded-[10px] border border-border bg-muted p-4"
                                        >
                                            <div
                                                class="text-sm font-medium text-foreground"
                                            >
                                                1. 严格命中区间
                                            </div>
                                            <p
                                                class="mt-2 text-sm leading-6 text-foreground"
                                            >
                                                输入值必须落在身高或体重区间内，不做模糊扩张。
                                            </p>
                                        </div>

                                        <div
                                            class="rounded-[10px] border border-border bg-muted p-4"
                                        >
                                            <div
                                                class="text-sm font-medium text-foreground"
                                            >
                                                2. 按整条进化链判断
                                            </div>
                                            <p
                                                class="mt-2 text-sm leading-6 text-foreground"
                                            >
                                                任一进化形态命中后，统一回落展示最低阶段精灵。
                                            </p>
                                        </div>

                                        <div
                                            class="rounded-[10px] border border-border bg-muted p-4"
                                        >
                                            <div
                                                class="text-sm font-medium text-foreground"
                                            >
                                                3. 按贴合度排序
                                            </div>
                                            <p
                                                class="mt-2 text-sm leading-6 text-foreground"
                                            >
                                                越接近区间中心、区间越收敛的候选，会排得更靠前。
                                            </p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </template>
            </div>
            <Income />
        </div>
    </section>
</template>

<style scoped></style>

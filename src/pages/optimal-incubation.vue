<script setup lang="ts">
import {
    Calculator,
    CheckCircle2,
    CircleAlert,
    Egg,
    Mars,
    Plus,
    Search,
    Sparkles,
    Star,
    Trash2,
    Trophy,
    UsersRound,
    Venus,
} from "lucide-vue-next";
import FriendPortrait from "@/components/FriendPortrait.vue";
import { formatEggGroup, formatEggGroupSummary } from "@/lib/eggGroups";
import type { IPets } from "@/lib/interface";
import {
    getPetImplementationLabel,
    isPetImplemented,
} from "@/lib/petImplementation";
import { formatPetHandbookNo, matchesPetKeyword } from "@/lib/petHandbook";
import {
    getSelectionIssue,
    optimizeIncubationPlans,
    type IIncubationPlan,
    type IIncubationSelection,
    type IncubationGender,
} from "@/lib/optimalIncubation";

interface IPersistedSelection {
    id: string;
    petId: number;
    gender: IncubationGender;
    shiny: boolean;
    colorful: boolean;
}

const pets = ref<IPets[]>([]);
const isLoading = ref(false);
const errorMessage = ref("");
const petPopoverOpen = ref(false);
const petSearchQuery = ref("");
const selectedPetId = ref<number | null>(null);
const draftGender = ref<IncubationGender>("female");
const draftShiny = ref(false);
const draftColorful = ref(false);
const nestCount = ref(10);
const selections = ref<IIncubationSelection[]>([]);
const planResults = ref<IIncubationPlan[]>([]);
const activePlanIndex = ref(0);
const resultMessage = ref("");
const resultStale = ref(false);
const selectionSerial = ref(0);
const focusSelectionIds = ref<string[]>([]);
const hasRestoredSelections = ref(false);

let petsController: AbortController | null = null;

const NEST_OPTIONS = Array.from({ length: 10 }, (_, index) => index + 1);
const MAX_PET_OPTIONS = 100;
const STORAGE_KEY = "optimal-incubation-state-v1";

const petsById = computed(() => {
    return new Map(pets.value.map((pet) => [pet.id, pet]));
});

const selectedPet = computed(() => {
    if (selectedPetId.value === null) {
        return null;
    }

    return petsById.value.get(selectedPetId.value) ?? null;
});

const candidateIssue = computed(() => {
    if (!selectedPet.value) {
        return null;
    }

    return getSelectionIssue({
        id: "draft",
        pet: selectedPet.value,
        gender: draftGender.value,
        shiny: draftShiny.value,
        colorful: draftColorful.value,
    });
});

const filteredPetOptions = computed(() => {
    const normalizedQuery = petSearchQuery.value
        .trim()
        .toLocaleLowerCase("zh-CN");

    const options = pets.value.filter((pet) => {
        if (!normalizedQuery) {
            return true;
        }

        return matchesPetKeyword(pet, normalizedQuery, [
            getPetImplementationLabel(pet),
            formatEggGroupSummary(pet.breeding_profile?.egg_groups ?? [], ""),
        ]);
    });

    return options
        .sort((left, right) => {
            return (
                Number(isPetImplemented(right)) -
                    Number(isPetImplemented(left)) ||
                left.localized.zh.name.localeCompare(
                    right.localized.zh.name,
                    "zh-CN",
                )
            );
        })
        .slice(0, MAX_PET_OPTIONS);
});

const maleSelections = computed(() => {
    return selections.value.filter((selection) => selection.gender === "male");
});

const femaleSelections = computed(() => {
    return selections.value.filter(
        (selection) => selection.gender === "female",
    );
});

const canAddSelection = computed(() => {
    return selectedPet.value !== null;
});

const selectionSummary = computed(() => {
    const geneReadyCount = selections.value.filter((selection) =>
        isGeneReady(selection),
    ).length;

    return {
        total: selections.value.length,
        male: maleSelections.value.length,
        female: femaleSelections.value.length,
        geneReady: geneReadyCount,
    };
});

const planResult = computed(() => {
    return planResults.value[activePlanIndex.value] ?? null;
});

const focusSelections = computed(() => {
    const focusIdSet = new Set(focusSelectionIds.value);

    return selections.value.filter((selection) =>
        focusIdSet.has(selection.id),
    );
});

onMounted(() => {
    void getPets();
});

onBeforeUnmount(() => {
    petsController?.abort();
});

function addSelection() {
    if (!selectedPet.value) {
        return;
    }

    selectionSerial.value += 1;
    selections.value = [
        ...selections.value,
        {
            id: `${selectedPet.value.id}-${draftGender.value}-${selectionSerial.value}`,
            pet: selectedPet.value,
            gender: draftGender.value,
            shiny: draftShiny.value,
            colorful: draftColorful.value,
        },
    ];

    selectedPetId.value = null;
    petSearchQuery.value = "";
    petPopoverOpen.value = false;
    markResultStale();
    persistState();
}

function removeSelection(selectionId: string) {
    selections.value = selections.value.filter(
        (selection) => selection.id !== selectionId,
    );
    focusSelectionIds.value = focusSelectionIds.value.filter(
        (id) => id !== selectionId,
    );
    markResultStale();
    persistState();
}

function updateSelectionGender(
    selectionId: string,
    gender: IncubationGender,
) {
    selections.value = selections.value.map((selection) => {
        if (selection.id !== selectionId) {
            return selection;
        }

        return {
            ...selection,
            gender,
        };
    });
    markResultStale();
    persistState();
}

function toggleSelectionFlag(
    selectionId: string,
    key: "shiny" | "colorful",
) {
    selections.value = selections.value.map((selection) => {
        if (selection.id !== selectionId) {
            return selection;
        }

        return {
            ...selection,
            [key]: !selection[key],
        };
    });
    markResultStale();
    persistState();
}

function clearSelections() {
    selections.value = [];
    focusSelectionIds.value = [];
    planResults.value = [];
    activePlanIndex.value = 0;
    resultMessage.value = "";
    resultStale.value = false;
    persistState();
}

function calculatePlan() {
    resultMessage.value = "";

    if (!selections.value.length) {
        resultMessage.value = "请先添加至少一只精灵。";
        planResults.value = [];
        activePlanIndex.value = 0;
        return;
    }

    if (nestCount.value < 1) {
        resultMessage.value = "请选择可供孵化的窝数量。";
        planResults.value = [];
        activePlanIndex.value = 0;
        return;
    }

    planResults.value = optimizeIncubationPlans(
        selections.value,
        nestCount.value,
        focusSelectionIds.value,
        10,
    );
    activePlanIndex.value = 0;
    resultStale.value = false;
    persistState();
}

function markResultStale() {
    if (planResults.value.length) {
        resultStale.value = true;
    }
}

function selectPet(petId: number) {
    selectedPetId.value = petId;
    petPopoverOpen.value = false;
}

function setNestCount(value: number) {
    nestCount.value = value;
    markResultStale();
    persistState();
}

function setFocusSelection(selectionId: string) {
    focusSelectionIds.value = focusSelectionIds.value.includes(selectionId)
        ? focusSelectionIds.value.filter((id) => id !== selectionId)
        : [...focusSelectionIds.value, selectionId];
    markResultStale();
    persistState();
}

function setActivePlan(index: number) {
    activePlanIndex.value = index;
}

function formatGender(gender: IncubationGender) {
    return gender === "female" ? "母体" : "父体";
}

function getGenderIcon(gender: IncubationGender) {
    return gender === "female" ? Venus : Mars;
}

function formatGenderRate(selection: IIncubationSelection) {
    const rate =
        selection.gender === "female"
            ? selection.pet.breeding_profile?.female_rate
            : selection.pet.breeding_profile?.male_rate;

    if (typeof rate !== "number") {
        return "概率未知";
    }

    return `${formatGender(selection.gender)}概率 ${rate}%`;
}

function getPetTypeLabel(pet: IPets) {
    return [pet.main_type.localized.zh, pet.sub_type?.localized.zh]
        .filter(Boolean)
        .join(" / ");
}

function getPetEggGroupLabel(pet: IPets) {
    return formatEggGroupSummary(
        pet.breeding_profile?.egg_groups ?? [],
        "暂无蛋组数据",
    );
}

function getSelectionTraitLabel(selection: IIncubationSelection) {
    if (selection.shiny && selection.colorful) {
        return "异色炫彩";
    }

    if (selection.shiny) {
        return "异色";
    }

    if (selection.colorful) {
        return "炫彩";
    }

    return "普通";
}

function isGeneReady(selection: IIncubationSelection) {
    return selection.shiny && selection.colorful;
}

function getSelectionIssueText(selection: IIncubationSelection) {
    return getSelectionIssue(selection);
}

function getCoveredFemaleCount(male: IIncubationSelection) {
    return (
        planResult.value?.assignments.filter(
            (assignment) => assignment.male.id === male.id,
        ).length ?? 0
    );
}

function getPlanCoveredFemaleCount(plan: IIncubationPlan, male: IIncubationSelection) {
    return plan.assignments.filter((assignment) => assignment.male.id === male.id)
        .length;
}

function getPlanTitle(plan: IIncubationPlan, index: number) {
    return `方案 ${index + 1} · ${plan.eggCount} 蛋 · ${plan.selectedMales.length} 父`;
}

function getPlanTraitSummary(plan: IIncubationPlan) {
    return `${plan.geneReadyCount} 异色炫彩 / ${plan.shinyPairCount} 异色 / ${plan.colorfulPairCount} 炫彩`;
}

function persistState() {
    if (typeof window === "undefined") {
        return;
    }

    const payload = {
        nestCount: nestCount.value,
        focusSelectionIds: focusSelectionIds.value,
        selectionSerial: selectionSerial.value,
        selections: selections.value.map((selection) => ({
            id: selection.id,
            petId: selection.pet.id,
            gender: selection.gender,
            shiny: selection.shiny,
            colorful: selection.colorful,
        })),
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function restoreState() {
    if (typeof window === "undefined" || hasRestoredSelections.value) {
        return;
    }

    hasRestoredSelections.value = true;
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
        return;
    }

    try {
        const payload = JSON.parse(raw) as {
            nestCount?: number;
            focusSelectionId?: string | null;
            focusSelectionIds?: string[];
            selectionSerial?: number;
            selections?: IPersistedSelection[];
        };

        if (typeof payload.nestCount === "number") {
            nestCount.value = Math.min(10, Math.max(1, payload.nestCount));
        }

        if (typeof payload.selectionSerial === "number") {
            selectionSerial.value = payload.selectionSerial;
        }

        const restoredSelections = (payload.selections ?? [])
            .map((item) => {
                const pet = petsById.value.get(item.petId);

                if (!pet) {
                    return null;
                }

                return {
                    id: item.id,
                    pet,
                    gender: item.gender,
                    shiny: Boolean(item.shiny),
                    colorful: Boolean(item.colorful),
                } satisfies IIncubationSelection;
            })
            .filter(
                (selection): selection is IIncubationSelection =>
                    selection !== null,
            );

        selections.value = restoredSelections;
        const restoredSelectionIds = new Set(
            restoredSelections.map((selection) => selection.id),
        );
        const savedFocusIds =
            payload.focusSelectionIds ??
            (payload.focusSelectionId ? [payload.focusSelectionId] : []);

        focusSelectionIds.value = savedFocusIds.filter((id) =>
            restoredSelectionIds.has(id),
        );
    } catch {
        window.localStorage.removeItem(STORAGE_KEY);
    }
}

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

        pets.value = await response.json();
        restoreState();
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            return;
        }

        errorMessage.value = "精灵数据加载失败，请稍后重试。";
        pets.value = [];
    } finally {
        isLoading.value = false;
    }
}

document.title = "蛋组 - 洛克王国工具箱";
</script>

<template>
    <section class="space-y-4">
        <Card>
            <CardHeader>
                <div
                    class="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"
                >
                    <div class="space-y-2">
                        <p
                            class="inline-flex items-center gap-2 text-xs tracking-[0.18em] text-foreground uppercase"
                        >
                            <Trophy class="h-3.5 w-3.5 text-foreground" />
                            Breeding Planner
                        </p>
                        <CardTitle
                            class="text-2xl tracking-tight text-foreground md:text-3xl"
                        >
                            蛋组
                        </CardTitle>
                    </div>

                    <div class="grid gap-3 sm:grid-cols-4">
                        <div
                            class="rounded-[10px] border border-border bg-muted px-4 py-3"
                        >
                            <p class="text-xs text-foreground">已选精灵</p>
                            <p
                                class="mt-2 text-2xl font-semibold text-foreground"
                            >
                                {{ selectionSummary.total }}
                            </p>
                        </div>
                        <div
                            class="rounded-[10px] border border-border bg-muted px-4 py-3"
                        >
                            <p class="text-xs text-foreground">母体</p>
                            <p
                                class="mt-2 text-2xl font-semibold text-foreground"
                            >
                                {{ selectionSummary.female }}
                            </p>
                        </div>
                        <div
                            class="rounded-[10px] border border-border bg-muted px-4 py-3"
                        >
                            <p class="text-xs text-foreground">父体</p>
                            <p
                                class="mt-2 text-2xl font-semibold text-foreground"
                            >
                                {{ selectionSummary.male }}
                            </p>
                        </div>
                        <div
                            class="rounded-[10px] border border-border bg-muted px-4 py-3"
                        >
                            <p class="text-xs text-foreground">异色炫彩</p>
                            <p
                                class="mt-2 text-2xl font-semibold text-foreground"
                            >
                                {{ selectionSummary.geneReady }}
                            </p>
                        </div>
                    </div>
                </div>
            </CardHeader>
        </Card>

        <Card>
            <CardHeader>
                <div
                    class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between"
                >
                    <div>
                        <CardTitle class="text-xl text-foreground">
                            窝数
                        </CardTitle>
                    </div>
                    <div class="grid grid-cols-5 gap-2 sm:grid-cols-10">
                        <button
                            v-for="value in NEST_OPTIONS"
                            :key="value"
                            type="button"
                            :class="[
                                'h-10 rounded-[10px] border px-3 text-sm font-medium transition-colors',
                                nestCount === value
                                    ? 'border-primary bg-primary text-primary-foreground'
                                    : 'border-border bg-muted text-foreground hover:bg-accent',
                            ]"
                            @click="setNestCount(value)"
                        >
                            {{ value }}
                        </button>
                    </div>
                </div>
            </CardHeader>
        </Card>

        <Card>
            <CardHeader>
                <div
                    class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between"
                >
                    <div>
                        <CardTitle class="text-xl text-foreground">
                            添加精灵
                        </CardTitle>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        <Button
                            variant="outline"
                            class="rounded-[10px] border-border bg-card text-foreground hover:bg-accent"
                            :disabled="!selections.length"
                            @click="clearSelections"
                        >
                            清空
                        </Button>
                        <Button
                            class="rounded-[10px]"
                            :disabled="!selections.length"
                            @click="calculatePlan"
                        >
                            <Calculator class="mr-2 h-4 w-4" />
                            开始计算
                        </Button>
                    </div>
                </div>
            </CardHeader>

            <CardContent class="space-y-4 px-4 pb-6">
                <div
                    v-if="errorMessage"
                    class="rounded-[10px] border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
                >
                    {{ errorMessage }}
                </div>

                <div
                    v-else-if="isLoading"
                    class="grid gap-4 lg:grid-cols-[1fr_1.2fr]"
                >
                    <Skeleton class="h-80 rounded-[10px] bg-muted" />
                    <Skeleton class="h-80 rounded-[10px] bg-muted" />
                </div>

                <template v-else>
                    <div class="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                        <div
                            class="rounded-[10px] border border-border bg-card p-4"
                        >
                            <div class="space-y-4">
                                <Popover v-model:open="petPopoverOpen">
                                    <PopoverTrigger as-child>
                                        <Button
                                            variant="outline"
                                            class="h-auto w-full justify-between rounded-[10px] border-border bg-muted px-4 py-3 text-left text-foreground hover:bg-accent"
                                        >
                                            <div class="min-w-0">
                                                <p
                                                    class="text-xs text-foreground"
                                                >
                                                    精灵种类
                                                </p>
                                                <p
                                                    class="mt-1 truncate text-sm font-medium text-foreground"
                                                >
                                                    {{
                                                        selectedPet?.localized
                                                            .zh.name ??
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
                                        v-if="petPopoverOpen"
                                        align="start"
                                        class="w-[min(32rem,calc(100vw-2rem))] border-border bg-slate-950/95 p-0 text-foreground"
                                    >
                                        <div class="border-b border-border p-3">
                                            <div class="relative">
                                                <Search
                                                    class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-foreground"
                                                />
                                                <Input
                                                    v-model="petSearchQuery"
                                                    placeholder="搜索名称、编号、属性、蛋组"
                                                    class="h-11 rounded-[10px] border-border bg-card pl-9 text-foreground placeholder:text-foreground"
                                                />
                                            </div>
                                        </div>

                                        <div
                                            v-if="!filteredPetOptions.length"
                                            class="px-4 py-8 text-sm text-foreground"
                                        >
                                            没有匹配的精灵。
                                        </div>

                                        <div
                                            v-else
                                            class="max-h-96 overflow-y-auto px-2 py-2"
                                        >
                                            <button
                                                v-for="pet in filteredPetOptions"
                                                :key="pet.id"
                                                type="button"
                                                class="mb-2 flex w-full items-center gap-3 rounded-[10px] border border-transparent bg-white/4 px-3 py-3 text-left text-foreground transition-colors hover:bg-muted"
                                                @click="selectPet(pet.id)"
                                            >
                                                <FriendPortrait
                                                    :name="pet.name"
                                                    :alt="
                                                        pet.localized.zh.name
                                                    "
                                                    class="h-10 w-12 shrink-0 rounded-[10px] border-border"
                                                    img-class="object-cover object-top"
                                                />
                                                <div
                                                    class="min-w-0 flex-1 space-y-1"
                                                >
                                                    <div
                                                        class="flex items-center gap-2"
                                                    >
                                                        <p
                                                            class="truncate font-medium text-foreground"
                                                        >
                                                            {{
                                                                pet.localized.zh
                                                                    .name
                                                            }}
                                                        </p>
                                                        <Badge
                                                            variant="outline"
                                                            class="rounded-[10px] border-border/20 bg-card px-1.5 py-0 text-[10px] text-foreground"
                                                        >
                                                            #{{
                                                                formatPetHandbookNo(
                                                                    pet,
                                                                )
                                                            }}
                                                        </Badge>
                                                        <Badge
                                                            v-if="
                                                                !isPetImplemented(
                                                                    pet,
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
                                                        {{ getPetTypeLabel(pet) }}
                                                        ·
                                                        {{
                                                            getPetEggGroupLabel(
                                                                pet,
                                                            )
                                                        }}
                                                    </p>
                                                </div>
                                            </button>
                                        </div>
                                    </PopoverContent>
                                </Popover>

                                <div class="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        :class="[
                                            'flex h-11 items-center justify-center gap-2 rounded-[10px] border text-sm font-medium transition-colors',
                                            draftGender === 'female'
                                                ? 'border-pink-300/40 bg-pink-300/15 text-pink-100'
                                                : 'border-border bg-muted text-foreground hover:bg-accent',
                                        ]"
                                        @click="draftGender = 'female'"
                                    >
                                        <Venus class="h-4 w-4" />
                                        母体
                                    </button>
                                    <button
                                        type="button"
                                        :class="[
                                            'flex h-11 items-center justify-center gap-2 rounded-[10px] border text-sm font-medium transition-colors',
                                            draftGender === 'male'
                                                ? 'border-sky-300/40 bg-sky-300/15 text-sky-100'
                                                : 'border-border bg-muted text-foreground hover:bg-accent',
                                        ]"
                                        @click="draftGender = 'male'"
                                    >
                                        <Mars class="h-4 w-4" />
                                        父体
                                    </button>
                                </div>

                                <div class="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        :class="[
                                            'flex h-11 items-center justify-center gap-2 rounded-[10px] border text-sm font-medium transition-colors',
                                            draftShiny
                                                ? 'border-fuchsia-300/40 bg-fuchsia-300/15 text-fuchsia-100'
                                                : 'border-border bg-muted text-foreground hover:bg-accent',
                                        ]"
                                        @click="draftShiny = !draftShiny"
                                    >
                                        <Sparkles class="h-4 w-4" />
                                        异色
                                    </button>
                                    <button
                                        type="button"
                                        :class="[
                                            'flex h-11 items-center justify-center gap-2 rounded-[10px] border text-sm font-medium transition-colors',
                                            draftColorful
                                                ? 'border-amber-300/40 bg-amber-300/15 text-amber-100'
                                                : 'border-border bg-muted text-foreground hover:bg-accent',
                                        ]"
                                        @click="
                                            draftColorful = !draftColorful
                                        "
                                    >
                                        <Sparkles class="h-4 w-4" />
                                        炫彩
                                    </button>
                                </div>

                                <div
                                    v-if="selectedPet"
                                    class="rounded-[10px] border border-border bg-muted p-3"
                                >
                                    <div class="flex items-center gap-3">
                                        <FriendPortrait
                                            :name="selectedPet.name"
                                            :alt="
                                                selectedPet.localized.zh.name
                                            "
                                            class="h-12 w-14 shrink-0 rounded-[10px] border-border"
                                            img-class="object-cover object-top"
                                        />
                                        <div class="min-w-0 flex-1">
                                            <p
                                                class="truncate font-medium text-foreground"
                                            >
                                                {{
                                                    selectedPet.localized.zh
                                                        .name
                                                }}
                                            </p>
                                            <p
                                                class="mt-1 truncate text-xs text-foreground"
                                            >
                                                {{
                                                    getPetEggGroupLabel(
                                                        selectedPet,
                                                    )
                                                }}
                                            </p>
                                        </div>
                                    </div>
                                    <p
                                        v-if="candidateIssue"
                                        class="mt-3 rounded-[10px] border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100"
                                    >
                                        {{ candidateIssue }}
                                    </p>
                                </div>

                                <Button
                                    class="w-full rounded-[10px]"
                                    :disabled="!canAddSelection"
                                    @click="addSelection"
                                >
                                    <Plus class="mr-2 h-4 w-4" />
                                    添加到列表
                                </Button>
                            </div>
                        </div>

                        <div
                            class="rounded-[10px] border border-border bg-card p-4"
                        >
                            <div
                                v-if="!selections.length"
                                class="flex min-h-72 items-center justify-center rounded-[10px] border border-dashed border-border bg-white/4 px-5 py-8 text-center text-sm text-foreground"
                            >
                                已添加的精灵会显示在这里。
                            </div>

                            <div v-else class="grid gap-3 md:grid-cols-2">
                                <div
                                    v-for="selection in selections"
                                    :key="selection.id"
                                    :class="[
                                        'rounded-[10px] border p-3 transition-colors',
                                        focusSelectionIds.includes(
                                            selection.id,
                                        )
                                            ? 'border-amber-300/40 bg-amber-300/10'
                                            : 'border-border bg-muted',
                                    ]"
                                >
                                    <div class="flex items-start gap-3">
                                        <FriendPortrait
                                            :name="selection.pet.name"
                                            :alt="
                                                selection.pet.localized.zh.name
                                            "
                                            class="h-14 w-16 shrink-0 rounded-[10px] border-border"
                                            img-class="object-cover object-top"
                                        />
                                        <div class="min-w-0 flex-1">
                                            <div
                                                class="flex items-start justify-between gap-2"
                                            >
                                                <div class="min-w-0">
                                                    <p
                                                        class="truncate font-medium text-foreground"
                                                    >
                                                        {{
                                                            selection.pet
                                                                .localized.zh
                                                                .name
                                                        }}
                                                    </p>
                                                    <p
                                                        class="mt-1 truncate text-xs text-foreground"
                                                    >
                                                        {{
                                                            getPetEggGroupLabel(
                                                                selection.pet,
                                                            )
                                                        }}
                                                    </p>
                                                </div>
                                                <div class="flex shrink-0 gap-1">
                                                    <button
                                                        type="button"
                                                        :class="[
                                                            'rounded-[10px] p-2 transition-colors',
                                                            focusSelectionIds.includes(
                                                                selection.id,
                                                            )
                                                                ? 'bg-amber-300/15 text-amber-100'
                                                                : 'text-foreground hover:bg-accent',
                                                        ]"
                                                        @click="
                                                            setFocusSelection(
                                                                selection.id,
                                                            )
                                                        "
                                                    >
                                                        <Star
                                                            class="h-4 w-4"
                                                        />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        class="rounded-[10px] p-2 text-foreground transition-colors hover:bg-accent"
                                                        @click="
                                                            removeSelection(
                                                                selection.id,
                                                            )
                                                        "
                                                    >
                                                        <Trash2
                                                            class="h-4 w-4"
                                                        />
                                                    </button>
                                                </div>
                                            </div>

                                            <div
                                                class="mt-3 grid grid-cols-2 gap-2"
                                            >
                                                <button
                                                    type="button"
                                                    :class="[
                                                        'flex h-9 items-center justify-center gap-1 rounded-[10px] border text-xs font-medium transition-colors',
                                                        selection.gender ===
                                                        'female'
                                                            ? 'border-pink-300/40 bg-pink-300/15 text-pink-100'
                                                            : 'border-border bg-card text-foreground hover:bg-accent',
                                                    ]"
                                                    @click="
                                                        updateSelectionGender(
                                                            selection.id,
                                                            'female',
                                                        )
                                                    "
                                                >
                                                    <Venus class="h-3.5 w-3.5" />
                                                    母体
                                                </button>
                                                <button
                                                    type="button"
                                                    :class="[
                                                        'flex h-9 items-center justify-center gap-1 rounded-[10px] border text-xs font-medium transition-colors',
                                                        selection.gender ===
                                                        'male'
                                                            ? 'border-sky-300/40 bg-sky-300/15 text-sky-100'
                                                            : 'border-border bg-card text-foreground hover:bg-accent',
                                                    ]"
                                                    @click="
                                                        updateSelectionGender(
                                                            selection.id,
                                                            'male',
                                                        )
                                                    "
                                                >
                                                    <Mars class="h-3.5 w-3.5" />
                                                    父体
                                                </button>
                                            </div>

                                            <div
                                                class="mt-2 grid grid-cols-2 gap-2"
                                            >
                                                <button
                                                    type="button"
                                                    :class="[
                                                        'h-9 rounded-[10px] border text-xs font-medium transition-colors',
                                                        selection.shiny
                                                            ? 'border-fuchsia-300/40 bg-fuchsia-300/15 text-fuchsia-100'
                                                            : 'border-border bg-card text-foreground hover:bg-accent',
                                                    ]"
                                                    @click="
                                                        toggleSelectionFlag(
                                                            selection.id,
                                                            'shiny',
                                                        )
                                                    "
                                                >
                                                    异色
                                                </button>
                                                <button
                                                    type="button"
                                                    :class="[
                                                        'h-9 rounded-[10px] border text-xs font-medium transition-colors',
                                                        selection.colorful
                                                            ? 'border-amber-300/40 bg-amber-300/15 text-amber-100'
                                                            : 'border-border bg-card text-foreground hover:bg-accent',
                                                    ]"
                                                    @click="
                                                        toggleSelectionFlag(
                                                            selection.id,
                                                            'colorful',
                                                        )
                                                    "
                                                >
                                                    炫彩
                                                </button>
                                            </div>

                                            <div
                                                class="mt-3 flex flex-wrap gap-2"
                                            >
                                                <Badge
                                                    variant="outline"
                                                    class="rounded-[10px] border-border/20 bg-card text-foreground"
                                                >
                                                    {{
                                                        formatGenderRate(
                                                            selection,
                                                        )
                                                    }}
                                                </Badge>
                                            </div>

                                            <p
                                                v-if="
                                                    getSelectionIssueText(
                                                        selection,
                                                    )
                                                "
                                                class="mt-3 rounded-[10px] border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100"
                                            >
                                                {{
                                                    getSelectionIssueText(
                                                        selection,
                                                    )
                                                }}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div
                        v-if="resultMessage"
                        class="rounded-[10px] border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100"
                    >
                        {{ resultMessage }}
                    </div>

                    <div
                        v-if="resultStale"
                        class="rounded-[10px] border border-sky-300/20 bg-sky-300/10 px-4 py-3 text-sm text-sky-100"
                    >
                        输入已变更，点击开始计算刷新结果。
                    </div>
                </template>
            </CardContent>
        </Card>

        <Card
            v-if="planResults.length && planResult"
            class="overflow-hidden border-border bg-card py-0 shadow-md"
        >
            <CardHeader class="gap-4 px-4 py-4">
                <div
                    class="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"
                >
                    <div>
                        <p
                            class="inline-flex items-center gap-2 text-xs tracking-[0.18em] text-foreground uppercase"
                        >
                            <Egg class="h-3.5 w-3.5 text-foreground" />
                            Plan
                        </p>
                        <CardTitle
                            class="mt-2 text-2xl tracking-tight text-foreground"
                        >
                            推荐方案
                        </CardTitle>
                        <p class="mt-2 text-sm text-foreground">
                            共生成 {{ planResults.length }} 种方案
                            <span v-if="focusSelections.length">
                                · 倾向
                                {{
                                    focusSelections
                                        .map(
                                            (selection) =>
                                                selection.pet.localized.zh.name,
                                        )
                                        .join(" / ")
                                }}
                            </span>
                        </p>
                    </div>

                    <div class="grid gap-3 sm:grid-cols-4">
                        <div
                            class="rounded-[10px] border border-border bg-muted px-4 py-3"
                        >
                            <p class="text-xs text-foreground">入窝</p>
                            <p
                                class="mt-2 text-2xl font-semibold text-foreground"
                            >
                                {{ planResult.placedSelections.length }}/{{
                                    planResult.nestCount
                                }}
                            </p>
                        </div>
                        <div
                            class="rounded-[10px] border border-border bg-muted px-4 py-3"
                        >
                            <p class="text-xs text-foreground">可下蛋</p>
                            <p
                                class="mt-2 text-2xl font-semibold text-foreground"
                            >
                                {{ planResult.eggCount }}
                            </p>
                        </div>
                        <div
                            class="rounded-[10px] border border-border bg-muted px-4 py-3"
                        >
                            <p class="text-xs text-foreground">推荐父体</p>
                            <p
                                class="mt-2 text-2xl font-semibold text-foreground"
                            >
                                {{ planResult.selectedMales.length }}
                            </p>
                        </div>
                        <div
                            class="rounded-[10px] border border-border bg-muted px-4 py-3"
                        >
                            <p class="text-xs text-foreground">基因组合</p>
                            <p
                                class="mt-2 text-2xl font-semibold text-foreground"
                            >
                                {{ planResult.geneReadyCount }}
                            </p>
                        </div>
                    </div>
                </div>
            </CardHeader>

            <CardContent class="space-y-5 px-4 pb-6">
                <div
                    v-if="planResults.length > 1"
                    class="grid gap-2 md:grid-cols-2 xl:grid-cols-5"
                >
                    <button
                        v-for="(plan, index) in planResults"
                        :key="`${plan.selectedMales.map((male) => male.id).join('-')}-${index}`"
                        type="button"
                        :class="[
                            'rounded-[10px] border p-3 text-left transition-colors',
                            activePlanIndex === index
                                ? 'border-primary bg-primary/10 text-foreground'
                                : 'border-border bg-muted text-foreground hover:bg-accent',
                        ]"
                        @click="setActivePlan(index)"
                    >
                        <p class="text-sm font-medium">
                            {{ getPlanTitle(plan, index) }}
                        </p>
                        <p class="mt-1 text-xs text-foreground">
                            {{ getPlanTraitSummary(plan) }}
                        </p>
                    </button>
                </div>

                <div
                    v-if="!planResult.eggCount"
                    class="rounded-[10px] border border-rose-400/20 bg-rose-500/10 p-4"
                >
                    <div class="flex items-start gap-3">
                        <CircleAlert class="h-5 w-5 shrink-0 text-rose-200" />
                        <div class="space-y-1">
                            <h3 class="font-semibold text-foreground">
                                暂无可用组合
                            </h3>
                            <p class="text-sm leading-6 text-rose-100/90">
                                当前输入无法在所选窝数内形成可配对方案。
                            </p>
                        </div>
                    </div>
                </div>

                <template v-else>
                    <div class="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
                        <div
                            class="rounded-[10px] border border-border bg-muted p-4"
                        >
                            <div class="flex items-center gap-2">
                                <UsersRound class="h-4 w-4 text-foreground" />
                                <h3 class="font-semibold text-foreground">
                                    推荐入窝父体
                                </h3>
                            </div>

                            <div class="mt-4 space-y-3">
                                <div
                                    v-for="male in planResult.selectedMales"
                                    :key="male.id"
                                    class="rounded-[10px] border border-border bg-card p-3"
                                >
                                    <div class="flex items-center gap-3">
                                        <FriendPortrait
                                            :name="male.pet.name"
                                            :alt="male.pet.localized.zh.name"
                                            class="h-12 w-14 shrink-0 rounded-[10px] border-border"
                                            img-class="object-cover object-top"
                                        />
                                        <div class="min-w-0 flex-1">
                                            <p
                                                class="truncate font-medium text-foreground"
                                            >
                                                {{
                                                    male.pet.localized.zh.name
                                                }}
                                            </p>
                                            <p
                                                class="mt-1 text-xs text-foreground"
                                            >
                                                覆盖
                                                {{
                                                    getPlanCoveredFemaleCount(
                                                        planResult,
                                                        male,
                                                    )
                                                }}
                                                个母体 ·
                                                {{
                                                    getSelectionTraitLabel(male)
                                                }}
                                            </p>
                                        </div>
                                        <component
                                            :is="getGenderIcon(male.gender)"
                                            class="h-4 w-4 shrink-0 text-sky-100"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div
                            class="rounded-[10px] border border-border bg-muted p-4"
                        >
                            <div class="flex items-center gap-2">
                                <CheckCircle2
                                    class="h-4 w-4 text-emerald-200"
                                />
                                <h3 class="font-semibold text-foreground">
                                    可下蛋母体
                                </h3>
                            </div>

                            <div class="mt-4 space-y-3">
                                <div
                                    v-for="assignment in planResult.assignments"
                                    :key="assignment.female.id"
                                    class="rounded-[10px] border border-border bg-card p-3"
                                >
                                    <div
                                        class="grid gap-3 md:grid-cols-[1fr_auto_1fr]"
                                    >
                                        <div class="flex min-w-0 items-center gap-3">
                                            <FriendPortrait
                                                :name="
                                                    assignment.female.pet.name
                                                "
                                                :alt="
                                                    assignment.female.pet
                                                        .localized.zh.name
                                                "
                                                class="h-12 w-14 shrink-0 rounded-[10px] border-border"
                                                img-class="object-cover object-top"
                                            />
                                            <div class="min-w-0">
                                                <p
                                                    class="truncate font-medium text-foreground"
                                                >
                                                    {{
                                                        assignment.female.pet
                                                            .localized.zh.name
                                                    }}
                                                </p>
                                                <p
                                                    class="mt-1 text-xs text-foreground"
                                                >
                                                    {{
                                                        getSelectionTraitLabel(
                                                            assignment.female,
                                                        )
                                                    }}
                                                </p>
                                            </div>
                                        </div>

                                        <div
                                            class="flex items-center justify-center"
                                        >
                                            <Badge
                                                variant="outline"
                                                class="rounded-[10px] border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
                                            >
                                                {{
                                                    assignment.sharedEggGroups
                                                        .length
                                                }}
                                                蛋组
                                            </Badge>
                                        </div>

                                        <div class="flex min-w-0 items-center gap-3">
                                            <FriendPortrait
                                                :name="assignment.male.pet.name"
                                                :alt="
                                                    assignment.male.pet
                                                        .localized.zh.name
                                                "
                                                class="h-12 w-14 shrink-0 rounded-[10px] border-border"
                                                img-class="object-cover object-top"
                                            />
                                            <div class="min-w-0">
                                                <p
                                                    class="truncate font-medium text-foreground"
                                                >
                                                    {{
                                                        assignment.male.pet
                                                            .localized.zh.name
                                                    }}
                                                </p>
                                                <p
                                                    class="mt-1 text-xs text-foreground"
                                                >
                                                    {{
                                                        getSelectionTraitLabel(
                                                            assignment.male,
                                                        )
                                                    }}
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div
                                        class="mt-3 flex flex-wrap items-center gap-2"
                                    >
                                        <Badge
                                            variant="outline"
                                            class="rounded-[10px] border-border/20 bg-muted text-foreground"
                                        >
                                            {{
                                                    assignment.sharedEggGroups
                                                        .map((groupId) =>
                                                            formatEggGroup(
                                                                groupId,
                                                            ),
                                                    )
                                                    .join(" / ")
                                            }}
                                        </Badge>
                                        <Badge
                                            v-if="assignment.geneReady"
                                            variant="outline"
                                            class="rounded-[10px] border-fuchsia-300/20 bg-fuchsia-300/10 text-fuchsia-100"
                                        >
                                            父母异色炫彩
                                        </Badge>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </template>

                <div
                    v-if="planResult.invalidSelections.length"
                    class="rounded-[10px] border border-amber-300/20 bg-amber-300/10 p-4"
                >
                    <div class="flex items-start gap-3">
                        <CircleAlert
                            class="h-5 w-5 shrink-0 text-amber-100"
                        />
                        <div class="space-y-2">
                            <h3 class="font-semibold text-foreground">
                                未参与计算
                            </h3>
                            <p
                                v-for="item in planResult.invalidSelections"
                                :key="item.selection.id"
                                class="text-sm text-amber-100"
                            >
                                {{ item.selection.pet.localized.zh.name }}：{{
                                    item.reason
                                }}
                            </p>
                        </div>
                    </div>
                </div>

                <div
                    v-if="planResult.unmatchedFemales.length"
                    class="rounded-[10px] border border-border bg-muted p-4"
                >
                    <h3 class="font-semibold text-foreground">
                        未覆盖母体
                    </h3>
                    <div class="mt-3 flex flex-wrap gap-2">
                        <Badge
                            v-for="female in planResult.unmatchedFemales"
                            :key="female.id"
                            variant="outline"
                            class="rounded-[10px] border-border/20 bg-card text-foreground"
                        >
                            {{ female.pet.localized.zh.name }}
                        </Badge>
                    </div>
                </div>
            </CardContent>
        </Card>
    </section>
</template>

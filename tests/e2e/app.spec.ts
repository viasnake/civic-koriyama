import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SearchIndexItem } from "../../src/shared/types";
import { availableSearchSuggestions, searchLocalItems } from "../../src/frontend/lib/localSearch";
import { largestUncoveredRect, rectanglesIntersect, type SafeRect } from "../../src/frontend/lib/mapSafeArea";
import { fallbackTokenizeSearchText, filterSearchTags, findPreparedSearchMatchRanges, findSearchMatchRanges, matchSearchFields, partitionSearchMatchRangesByValues, prepareSearchFields, prepareSearchIndex, tokenizeSearchText } from "../../src/frontend/lib/searchMatcher";
import { selectVisibleTagIndices } from "../../src/frontend/lib/tagSelection";

const generatedFixtureDir = resolve("tests/fixtures/generated");

function findGuaranteedInternalSubstring(value: string): string | undefined {
  for (let start = 1; start < value.length - 1; start += 1) {
    for (let end = start + 1; end < value.length; end += 1) {
      const candidate = value.slice(start, end);
      if (candidate && !value.startsWith(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function generatedDistinctRun(
  alphabet: string,
  next: (limit: number) => number,
  includeLongVowel = false
): string {
  const characters = Array.from(alphabet);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const runCharacters = Array.from({ length: 6 + next(5) }, () => characters[next(characters.length)]);
    if (includeLongVowel && !runCharacters.includes("ー")) {
      runCharacters[next(runCharacters.length)] = "ー";
    }
    const run = runCharacters.join("");
    if (new Set(runCharacters).size >= 4 && findGuaranteedInternalSubstring(run)) {
      return run;
    }
  }
  const fallbackCharacters = characters.filter((character, index) => characters.indexOf(character) === index).slice(0, 6);
  if (includeLongVowel && !fallbackCharacters.includes("ー")) {
    fallbackCharacters[fallbackCharacters.length - 1] = "ー";
  }
  const fallbackRun = fallbackCharacters.join("");
  if (new Set(fallbackCharacters).size < 4 || !findGuaranteedInternalSubstring(fallbackRun)) {
    throw new Error("generated run must have a guaranteed internal substring");
  }
  return fallbackRun;
}

test.beforeEach(async ({ page }) => {
  await routeGeneratedData(page);
});

test.describe("visual regression", () => {
  const viewports = [
    { name: "mobile", width: 390, height: 844 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 900 }
  ];

  for (const viewport of viewports) {
    test(`home ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "郡山で必要な情報を、すぐに。" })).toBeVisible();
      await expect(page).toHaveScreenshot(`home-${viewport.name}.png`, {
        fullPage: true,
        animations: "disabled"
      });
    });
  }
});

test.describe("accessibility", () => {
  const routes = ["/", "/news", "/search?type=place&category=aed", "/map?category=aed"];

  for (const route of routes) {
    test(`axe ${route}`, async ({ page }) => {
      await page.goto(route);
      await page.locator("main").waitFor();
      const results = await new AxeBuilder({ page }).include("main").analyze();

      expect(results.violations).toEqual([]);
    });
  }
});

test("news renders 24 items first and loads 24 more", async ({ page }) => {
  await page.goto("/news");
  await expect(page.getByRole("heading", { name: "すべてのお知らせ 31件" })).toBeVisible();
  await expect(page.locator(".news-card")).toHaveCount(24);

  await page.getByRole("button", { name: "さらに表示" }).click();
  await expect(page.locator(".news-card")).toHaveCount(31);

  await page.getByRole("button", { name: "防災" }).click();
  await expect(page.getByRole("button", { name: "防災" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "防災のお知らせ 5件" })).toBeVisible();
  await expect(page.locator(".news-card")).toHaveCount(5);
});

test("news card click target covers the card", async ({ page }) => {
  await page.goto("/news");
  const initialUrl = page.url();
  const card = page.locator(".news-card").first();
  const link = card.locator("h3 a").first();
  await expect(card).toBeVisible();
  await expect(link).toBeVisible();

  const axisFractions = [0.2, 0.5, 0.8];
  const points: Array<{ x: number; y: number; box: NonNullable<Awaited<ReturnType<typeof card.boundingBox>>> }> = [];

  await link.evaluate((element) => {
    const target = element as HTMLAnchorElement & { __testClickHandler?: (event: Event) => void };
    const handler = (event: Event) => {
      event.preventDefault();
      target.dataset.testClickCount = String(Number(target.dataset.testClickCount ?? "0") + 1);
    };
    target.dataset.testClickCount = "0";
    target.__testClickHandler = handler;
    target.addEventListener("click", handler);
  });

  try {
    for (const yFraction of axisFractions) {
      await card.evaluate((element, fraction) => {
        const rect = element.getBoundingClientRect();
        window.scrollBy(0, rect.top + rect.height * (0.1 + 0.8 * fraction) - window.innerHeight / 2);
      }, yFraction);
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      if (!box) {
        throw new Error("news card must have a measurable bounding box");
      }
      for (const xFraction of axisFractions) {
        const point = {
          x: box.x + box.width * (0.1 + 0.8 * xFraction),
          y: box.y + box.height * (0.1 + 0.8 * yFraction),
          box
        };
        expect(point.x).toBeGreaterThan(box.x);
        expect(point.x).toBeLessThan(box.x + box.width);
        expect(point.y).toBeGreaterThan(box.y);
        expect(point.y).toBeLessThan(box.y + box.height);
        points.push(point);
        await page.mouse.click(point.x, point.y);
        await expect(link).toHaveAttribute("data-test-click-count", String(points.length));
        await expect(page).toHaveURL(initialUrl);
      }
    }
  } finally {
    await link.evaluate((element) => {
      const target = element as HTMLAnchorElement & { __testClickHandler?: (event: Event) => void };
      if (target.__testClickHandler) {
        target.removeEventListener("click", target.__testClickHandler);
        delete target.__testClickHandler;
      }
    });
  }
});

test("structured place category search returns places and map link", async ({ page }) => {
  await page.goto("/search?type=place&category=aed");

  await expect(page.getByRole("heading", { name: "関連する情報 2件" })).toBeVisible();
  await expect(page.locator(".place-card")).toHaveCount(2);
  await expect(page.getByRole("link", { name: /地図で見る（2施設）/ }).first()).toHaveAttribute("href", "/map?category=aed");
});

test("category-only search does not load query-dependent official results", async ({ page }) => {
  const fixture = JSON.parse(
    await readFile(resolve(generatedFixtureDir, "search-index.json"), "utf8")
  ) as { items: SearchIndexItem[] };
  const place = fixture.items.find((item) => item.type === "place" && (item.categories?.length || item.category));
  const category = place?.categories?.[0] ?? place?.category;

  expect(category).toBeTruthy();
  await page.goto(`/search?type=place&category=${encodeURIComponent(category ?? "")}`);

  await expect(page.locator(".active-filter")).toBeVisible();
  await expect(page.getByRole("heading", { name: "郡山市公式サイト" })).toHaveCount(0);
  await expect(page.locator("#google-programmable-search")).toHaveCount(0);
});

test("free text search can be limited to news", async ({ page }) => {
  await page.goto("/search?q=熱中症&type=news");

  await expect(page.getByRole("heading", { name: "関連する情報 1件" })).toBeVisible();
  await expect(page.locator(".news-card")).toHaveCount(1);
  await expect(page.locator(".news-card mark").first()).toHaveText("熱中症");
  await expect(page.locator(".place-card")).toHaveCount(0);
});

test("tag-only search highlights the matching news tag", async ({ page }) => {
  await page.goto("/search?q=防災&type=news");
  const result = page.locator(".news-card").filter({ hasText: "熱中症に注意してください" }).first();
  await expect(result).toBeVisible();
  await expect(result.locator("h3 mark")).toHaveCount(0);
  await expect(result.locator(".tag-row span").first().locator("mark")).toHaveCount(0);
  await expect(result.locator(".tag-row span").nth(1).locator("mark")).toHaveText("防災");
});

test("free text search ranks title matches above incidental keyword matches", async ({ page }) => {
  await page.goto("/search?q=ごみ");
  await expect(page.locator(".section").first().locator("h3 a").first()).toHaveText("ごみ収集日の変更");
  await expect(page.getByText("なごみ保育園", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /地図で見る/ })).toHaveCount(0);

  await page.goto("/search?q=住民票");
  await expect(page.locator(".section").first().locator("h3 a").first()).toHaveText("住民票の手続き");
  await expect(page.getByText("音楽祭を開催します", { exact: true })).toHaveCount(0);
});

test("search matcher preserves generic token invariants across generated scripts and normalization", async () => {
  const scripts = [
    ["hiragana", "あいうえおかきくけこ"],
    ["katakana", "アイウエオカキクケコ"],
    ["han", "日月火水木金土"],
    ["latin", "abcdefghijk"],
    ["number", "0123456789"]
  ] as const;
  let state = 0x51f15e;
  const next = (length: number) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state % length;
  };

  for (const [, alphabet] of scripts) {
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const word = Array.from({ length: 2 + next(4) }, () => alphabet[next(alphabet.length)]).join("");
      const internal = word.slice(1, -1);
      expect(matchSearchFields(word, [{ name: "name", value: word }], fallbackTokenizeSearchText).score).toBeGreaterThan(0);
      expect(matchSearchFields(word, [{ name: "name", value: `${word}施設` }], fallbackTokenizeSearchText).score).toBeGreaterThan(0);
      expect(matchSearchFields(word, [{ name: "tags", value: `分類 ${word}` }], fallbackTokenizeSearchText).score).toBeGreaterThan(0);
      if (internal && !word.startsWith(internal)) {
        expect(matchSearchFields(internal, [{ name: "name", value: word }], fallbackTokenizeSearchText).score).toBe(0);
      }
    }
  }

  for (const alphabet of ["あいうえおかきくけこ", "アイウエオカキクケコ"]) {
    for (let iteration = 0; iteration < 32; iteration += 1) {
      const run = generatedDistinctRun(alphabet, next);
      const internal = findGuaranteedInternalSubstring(run);
      expect(internal).toBeDefined();
      for (const tokenizer of [tokenizeSearchText, fallbackTokenizeSearchText]) {
        expect(tokenizer(run).length).toBeGreaterThan(0);
        expect(matchSearchFields(run, [{ name: "name", value: run }], tokenizer).score).toBeGreaterThan(0);
        expect(matchSearchFields(run, [{ name: "name", value: `${run}施設` }], tokenizer).score).toBeGreaterThan(0);
        const strictPrefix = run.slice(0, -1);
        expect(strictPrefix.length).toBeGreaterThan(0);
        expect(strictPrefix.length).toBeLessThan(run.length);
        expect(matchSearchFields(strictPrefix, [{ name: "name", value: run }], tokenizer).score).toBeGreaterThan(0);
        expect(matchSearchFields(strictPrefix, [{ name: "name", value: `${run}施設` }], tokenizer).score).toBeGreaterThan(0);
        expect(matchSearchFields(internal!, [{ name: "name", value: run }], tokenizer).score).toBe(0);
        expect(matchSearchFields(internal!, [{ name: "name", value: `前${run}後` }], tokenizer).score).toBe(0);
      }
    }
  }

  expect(matchSearchFields("civic", [{ name: "name", value: "civic-center" }]).score).toBeGreaterThan(0);
  expect(matchSearchFields("ＣＩＶＩＣ", [{ name: "name", value: "civic-center" }]).score).toBeGreaterThan(0);
  expect(matchSearchFields("12", [{ name: "address", value: "１２番地" }]).score).toBeGreaterThan(0);
  expect(matchSearchFields("beta", [{ name: "name", value: "alpha beta gamma" }], fallbackTokenizeSearchText).score).toBeGreaterThan(0);
  expect(matchSearchFields("foo-bar", [{ name: "name", value: "foo—bar" }], fallbackTokenizeSearchText).score).toBeGreaterThan(0);
  expect(matchSearchFields("alpha ごみ", [
    { name: "name", value: "alpha office" },
    { name: "tags", value: "ごみ" }
  ]).score).toBeGreaterThan(0);
  expect(matchSearchFields("alpha ごみ", [{ name: "name", value: "alpha office" }]).score).toBe(0);

  expect(filterSearchTags(["かな", "分類"], ["かな施設", "くらし"])).toEqual(["かな"]);
  expect(filterSearchTags(["分類"], ["かな施設", "くらし"])).toEqual([]);

  expect(fallbackTokenizeSearchText("かなカナ漢字abc123").map((token) => token.text)).toEqual(["かな", "カナ", "漢字", "abc", "123"]);
  expect(fallbackTokenizeSearchText("かな・カナ_漢字/abc").map((token) => token.text)).toEqual(["かな", "カナ", "漢字", "abc"]);
  expect(fallbackTokenizeSearchText("😀𝄞𝒜").map((token) => token.text)).toEqual(["a"]);
  expect(tokenizeSearchText("かな施設").length).toBeGreaterThan(0);
  expect(matchSearchFields("   !!!  ", [{ name: "name", value: "anything" }]).score).toBe(0);

  expect(findSearchMatchRanges("😀 ＣＩＶＩＣ 🏛️", "civic")).toEqual([{ start: 3, end: 8 }]);
  expect(findSearchMatchRanges("alpha beta", "beta alpha")).toEqual([{ start: 0, end: 5 }, { start: 6, end: 10 }]);
  expect(findSearchMatchRanges("  foo   bar ", "bar foo")).toEqual([{ start: 2, end: 5 }, { start: 8, end: 11 }]);
  expect(findSearchMatchRanges("alpha", "alpha al")).toEqual([{ start: 0, end: 5 }]);
  expect(findSearchMatchRanges("あかなね", "かな", fallbackTokenizeSearchText)).toEqual([]);
  expect(findSearchMatchRanges("かな施設", "かな", fallbackTokenizeSearchText)).toEqual([{ start: 0, end: 2 }]);
  expect(findSearchMatchRanges("１２番地", "12")).toEqual([{ start: 0, end: 2 }]);

  const equivalenceCases = [
    ["e", "\u0301"],
    ["a", "\u0308"],
    ["か", "\u3099"],
    ["は", "\u309a"]
  ] as const;
  for (const [base, combiningMark] of equivalenceCases) {
    const decomposed = `${base}${combiningMark}`;
    const composed = decomposed.normalize("NFC");
    for (const tokenizer of [tokenizeSearchText, fallbackTokenizeSearchText]) {
      expect(matchSearchFields(composed, [{ name: "name", value: decomposed }], tokenizer).score).toBeGreaterThan(0);
      expect(matchSearchFields(decomposed, [{ name: "name", value: composed }], tokenizer).score).toBeGreaterThan(0);
      expect(findSearchMatchRanges(decomposed, composed, tokenizer)).toEqual([{ start: 0, end: decomposed.length }]);
      expect(findSearchMatchRanges(composed, decomposed, tokenizer)).toEqual([{ start: 0, end: composed.length }]);
    }
  }

  const kanaWithLongVowel = ["カ", "キ", "ク", "ケ", "コ", "サ", "シ", "ス", "セ", "ソ", "ー"];
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const run = generatedDistinctRun(kanaWithLongVowel.join(""), next, true);
    const internal = findGuaranteedInternalSubstring(run);
    expect(internal).toBeDefined();
    for (const tokenizer of [tokenizeSearchText, fallbackTokenizeSearchText]) {
      expect(matchSearchFields(run, [{ name: "name", value: run }], tokenizer).score).toBeGreaterThan(0);
      expect(matchSearchFields(run, [{ name: "name", value: `${run}施設` }], tokenizer).score).toBeGreaterThan(0);
      const prefix = run.slice(0, -1);
      expect(prefix.length).toBeLessThan(run.length);
      expect(matchSearchFields(prefix, [{ name: "name", value: run }], tokenizer).score).toBeGreaterThan(0);
      expect(matchSearchFields(prefix, [{ name: "name", value: `${run}施設` }], tokenizer).score).toBeGreaterThan(0);
      expect(matchSearchFields(internal!, [{ name: "name", value: run }], tokenizer).score).toBe(0);
      expect(matchSearchFields(internal!, [{ name: "name", value: `前${run}後` }], tokenizer).score).toBe(0);
      expect(findSearchMatchRanges(`前${run}後`, internal!, tokenizer)).toEqual([]);
    }
  }

  const halfWidthKatakana = "ｽｰﾊﾟｰ";
  for (const tokenizer of [tokenizeSearchText, fallbackTokenizeSearchText]) {
    expect(matchSearchFields("スーパー", [{ name: "name", value: halfWidthKatakana }], tokenizer).score).toBeGreaterThan(0);
    expect(findSearchMatchRanges(halfWidthKatakana, "スーパー", tokenizer)).toEqual([{ start: 0, end: halfWidthKatakana.length }]);
  }

  const supplementarySource = "😀𝄞𝒜";
  for (const tokenizer of [tokenizeSearchText, fallbackTokenizeSearchText]) {
    expect(matchSearchFields("A", [{ name: "name", value: supplementarySource }], tokenizer).score).toBeGreaterThan(0);
    expect(findSearchMatchRanges(supplementarySource, "A", tokenizer)).toEqual([{ start: 4, end: 6 }]);
  }

  const syntheticItems: SearchIndexItem[] = [0, 1, 2].map((index) => ({
    id: `algorithm-item-${index}`,
    type: "place",
    name: index === 0 ? "alpha" : `unrelated-${index}`,
    category: "facility",
    categoryLabel: "施設",
    keywords: ""
  }));
  const syntheticPreparationStats = { itemsPrepared: 0, fieldsPrepared: 0 };
  const syntheticPrepared = prepareSearchIndex(syntheticItems, tokenizeSearchText, syntheticPreparationStats);
  const firstResults = searchLocalItems("alpha", syntheticPrepared);
  const secondResults = searchLocalItems("alpha", syntheticPrepared);
  expect(firstResults.map((result) => result.item)).toEqual([syntheticItems[0]]);
  expect(secondResults.map((result) => result.item)).toEqual([syntheticItems[0]]);
  expect(firstResults[0].reason).toBe("名称に一致");
  expect(firstResults[0].match.evidence.length).toBeGreaterThan(0);
  expect(syntheticPreparationStats).toEqual({ itemsPrepared: 3, fieldsPrepared: 15 });
  const syntheticSuggestionStats = { candidateVisits: 0, matchesFound: 0, queryPreparations: 0 };
  expect(availableSearchSuggestions(["alpha"], syntheticPrepared, 1, syntheticSuggestionStats)).toEqual(["alpha"]);
  expect(syntheticPreparationStats).toEqual({ itemsPrepared: 3, fieldsPrepared: 15 });
  expect(syntheticSuggestionStats).toEqual({ candidateVisits: 1, matchesFound: 1, queryPreparations: 1 });

  const generatedIndex = JSON.parse(await readFile(resolve(generatedFixtureDir, "search-index.json"), "utf8")) as { items: SearchIndexItem[] };
  const generatedPreparationStats = { itemsPrepared: 0, fieldsPrepared: 0 };
  const generatedPrepared = prepareSearchIndex(generatedIndex.items, tokenizeSearchText, generatedPreparationStats);
  const generatedSuggestionStats = { candidateVisits: 0, matchesFound: 0, queryPreparations: 0 };
  const generatedSuggestions = availableSearchSuggestions(["ごみ", "住民票", "子育て", "防災", "税金", "イベント", "補助金", "健康"], generatedPrepared, 4, generatedSuggestionStats);
  expect(generatedPreparationStats).toEqual({ itemsPrepared: generatedIndex.items.length, fieldsPrepared: generatedIndex.items.length * 5 });
  expect(generatedSuggestionStats.matchesFound).toBe(generatedSuggestions.length);
  expect(generatedSuggestionStats.candidateVisits).toBeLessThan(generatedIndex.items.length * generatedSuggestions.length);

  const matcherSource = await readFile(resolve("src/frontend/lib/searchMatcher.ts"), "utf8");
  const localSearchSource = await readFile(resolve("src/frontend/lib/localSearch.ts"), "utf8");
  const indexBuilderSource = await readFile(resolve("scripts/build-search-index.ts"), "utf8");
  expect(`${matcherSource}\n${localSearchSource}\n${indexBuilderSource}`).not.toMatch(/ごみ|住民票|なごみ/);
});

test("prepared multi-value tag ranges stay aligned for generated values", async () => {
  const atoms = ["a", "ｅ", "́", "か", "゙", "パ", "ー", "漢", "1", "😀", "𝄞", "·", " "];
  let state = 0x7f4a7c15;
  const next = (limit: number) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state % limit;
  };
  const mergeRanges = (ranges: Array<{ start: number; end: number }>) => [...ranges]
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .reduce<Array<{ start: number; end: number }>>((merged, range) => {
      const previous = merged.at(-1);
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else if (range.end > range.start) {
        merged.push({ ...range });
      }
      return merged;
    }, []);

  for (const tokenizer of [tokenizeSearchText, fallbackTokenizeSearchText]) {
    for (let iteration = 0; iteration < 96; iteration += 1) {
      const tags = Array.from({ length: 1 + next(8) }, () => Array.from({ length: next(6) }, () => atoms[next(atoms.length)]).join(""));
      if (iteration % 2 === 0 && tags.length > 1) {
        tags[tags.length - 1] = tags[0];
      }
      const sourceIndex = tags.findIndex((tag) => tokenizer(tag).length > 0);
      if (sourceIndex < 0) {
        tags[0] = "e\u0301";
      }
      const queryToken = tokenizer(tags[sourceIndex < 0 ? 0 : sourceIndex])[0];
      if (!queryToken) {
        throw new Error("generated tag must contain a token");
      }
      const preparedField = prepareSearchFields([{
        name: "tags",
        value: tags.join(" "),
        values: tags
      }], tokenizer)[0];
      const ranges = findPreparedSearchMatchRanges(preparedField, [queryToken], tokenizer);
      const partitions = partitionSearchMatchRangesByValues(tags, ranges);

      expect(partitions).toHaveLength(tags.length);
      let valueStart = 0;
      tags.forEach((tag, tagIndex) => {
        const valueEnd = valueStart + tag.length;
        const expected = mergeRanges(ranges.flatMap((range) => {
          const start = Math.max(valueStart, Math.min(valueEnd, range.start));
          const end = Math.max(valueStart, Math.min(valueEnd, range.end));
          return end > start ? [{ start: start - valueStart, end: end - valueStart }] : [];
        }));
        expect(partitions[tagIndex]).toEqual(expected);
        for (const range of partitions[tagIndex]) {
          expect(range.start).toBeGreaterThanOrEqual(0);
          expect(range.end).toBeLessThanOrEqual(tag.length);
          expect(range.end).toBeGreaterThan(range.start);
        }
        valueStart = valueEnd + 1;
      });
    }
  }
});

test("visible tag selection stays bounded and prioritizes prepared highlights", async () => {
  let state = 0x243f6a88;
  const next = (limit: number) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state % limit;
  };
  const limits = [-3, -1, 0, 1, 2, 3, 5, 12, Number.NaN, Number.POSITIVE_INFINITY];

  for (let iteration = 0; iteration < 160; iteration += 1) {
    const tags = Array.from({ length: next(32) }, (_, index) => index % 4 === 0 ? "重複" : `tag-${index % 7}`);
    const rangeLength = next(tags.length + 8);
    const ranges = Array.from({ length: rangeLength }, (_, index) => {
      if (index % 4 === 0) return [{ start: 0, end: 1 }];
      if (index % 4 === 1) return [];
      return undefined;
    });
    const limit = limits[next(limits.length)];
    const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
    const highlighted = tags.map((_, index) => index).filter((index) => (ranges[index]?.length ?? 0) > 0);
    const expected = highlighted.slice(0, safeLimit);
    for (let index = 0; index < tags.length && expected.length < safeLimit; index += 1) {
      if (!highlighted.includes(index)) {
        expected.push(index);
      }
    }
    expected.sort((left, right) => left - right);

    const selected = selectVisibleTagIndices(tags, ranges, limit);
    expect(selected).toEqual(expected);
    expect(selected.length).toBeLessThanOrEqual(Math.min(tags.length, safeLimit));
    expect(new Set(selected).size).toBe(selected.length);
    expect(selected).toEqual([...selected].sort((left, right) => left - right));
    expect(selected.every((index) => index >= 0 && index < tags.length)).toBe(true);
    if (highlighted.length <= safeLimit) {
      expect(highlighted.every((index) => selected.includes(index))).toBe(true);
    } else {
      expect(selected.filter((index) => highlighted.includes(index))).toEqual(highlighted.slice(0, safeLimit));
    }
  }
});

test("maximum safe rectangle considers all obstacle boundary pairs", async () => {
  const topRightObstacle = { left: 80, top: 0, right: 100, bottom: 20 };
  expect(largestUncoveredRect(100, 100, [topRightObstacle])).toEqual({ left: 0, top: 0, right: 80, bottom: 100 });
  expect(largestUncoveredRect(100, 100, [])).toEqual({ left: 0, top: 0, right: 100, bottom: 100 });
  expect(largestUncoveredRect(100, 100, [{ left: -20, top: -20, right: 120, bottom: 120 }])).toBeUndefined();
  expect(largestUncoveredRect(100, 100, [
    { left: 72, top: 8, right: 100, bottom: 35 },
    { left: 76, top: 0, right: 100, bottom: 18 }
  ])).toBeDefined();

  let state = 0x9e3779b9;
  const next = (limit: number) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state % limit;
  };
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const width = 3 + next(6);
    const height = 3 + next(6);
    const clearance = next(3);
    const obstacles: SafeRect[] = Array.from({ length: next(6) }, (_, obstacleIndex) => {
      if (obstacleIndex === 0 && iteration % 13 === 0) {
        return { left: -2, top: -2, right: width + 2, bottom: height + 2 };
      }
      const left = next(width + 6) - 3;
      const top = next(height + 6) - 3;
      return {
        left,
        top,
        right: left + 1 + next(width + 3),
        bottom: top + 1 + next(height + 3)
      };
    });
    const result = largestUncoveredRect(width, height, obstacles, clearance);
    expect(result).toEqual(bruteForceLargestUncoveredRect(width, height, obstacles, clearance));
  }
});

function bruteForceLargestUncoveredRect(width: number, height: number, obstacles: SafeRect[], clearance: number): SafeRect | undefined {
  const inset = Math.max(0, clearance);
  const bounds = {
    left: Math.ceil(inset),
    top: Math.ceil(inset),
    right: Math.floor(width - inset),
    bottom: Math.floor(height - inset)
  };
  if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
    return undefined;
  }

  const clippedObstacles = obstacles
    .map((obstacle) => ({
      left: Math.max(bounds.left, obstacle.left - inset),
      top: Math.max(bounds.top, obstacle.top - inset),
      right: Math.min(bounds.right, obstacle.right + inset),
      bottom: Math.min(bounds.bottom, obstacle.bottom + inset)
    }))
    .filter((obstacle) => obstacle.right > obstacle.left && obstacle.bottom > obstacle.top);

  let best: SafeRect | undefined;
  let bestArea = 0;
  for (let left = bounds.left; left < bounds.right; left += 1) {
    for (let right = left + 1; right <= bounds.right; right += 1) {
      for (let top = bounds.top; top < bounds.bottom; top += 1) {
        for (let bottom = top + 1; bottom <= bounds.bottom; bottom += 1) {
          const candidate = { left, top, right, bottom };
          if (clippedObstacles.some((obstacle) => rectanglesIntersect(candidate, obstacle))) {
            continue;
          }
          const area = (right - left) * (bottom - top);
          const earlier = !best
            || top < best.top
            || (top === best.top && left < best.left)
            || (top === best.top && left === best.left && bottom < best.bottom)
            || (top === best.top && left === best.left && bottom === best.bottom && right < best.right);
          if (area > bestArea || (area === bestArea && earlier)) {
            best = candidate;
            bestArea = area;
          }
        }
      }
    }
  }
  return best;
}

test("map list selects a place on the same page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/map?category=aed");

  await expect(page.getByText("2施設を表示しています。地図の位置は目安です。")).toBeVisible();
  await expect(page.getByRole("group", { name: "表示方法" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "施設一覧" })).toBeVisible();
  await expect(page.locator(".map-place-select")).toHaveCount(2);

  await page.locator(".map-place-select").first().click();
  await expect(page).toHaveURL(/\/map\?category=aed&selected=place_aed_1&view=map/);
  await expect(page.getByRole("button", { name: "閉じる" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "郡山駅前AED" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "郡山駅前AED" })).toBeFocused();
  await expect(page.locator(".map-canvas")).toBeInViewport();
  await expect(page.locator(".map-pin.is-selected")).toBeVisible();
  await page.getByRole("button", { name: "閉じる" }).click();
  await expect(page.locator(".map-place-select").first()).toBeFocused();
});

test("selected mobile marker stays inside the unobscured map area", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });

  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/map?category=aed&view=list");
    await page.locator(".map-place-select").first().click();
    await expect(page.locator(".map-pin.is-selected")).toHaveCount(1);
    await expect(page.locator(".map-detail-popover h2")).toBeFocused();

    const geometry = await selectedMapGeometry(page);
    expect(geometry.markerCenterHit).toBe(true);
    expect(geometry.intersections).toEqual([]);
    expect(geometry.selectedCount).toBe(1);
  }

  expect(errors).toEqual([]);
});

test("map selection survives deterministic marker replacement stress without Leaflet errors", async ({ page }) => {
  test.setTimeout(120_000);
  const stressData = makeStressMapData();
  for (const file of ["places.json", "places.geojson", "search-index.json"]) {
    await page.unroute(`**/generated/${file}`);
  }
  await page.route("**/generated/places.json", (route) => route.fulfill({ json: stressData.places }));
  await page.route("**/generated/places.geojson", (route) => route.fulfill({ json: stressData.geojson }));
  await page.route("**/generated/search-index.json", (route) => route.fulfill({ json: stressData.searchIndex }));

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/map?category=aed&view=list");
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator(".map-place-select")).toHaveCount(60);

  for (let cycle = 0; cycle < 30; cycle += 1) {
    const place = stressData.places.places[cycle];
    const row = page.locator(`[data-place-id="${place.id}"]`);
    await row.click();
    await expect.poll(() => new URL(page.url()).searchParams.get("selected")).toBe(place.id);
    await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("map");
    await expect(page.getByRole("heading", { name: place.name })).toBeFocused();
    await expect(page.locator(".map-pin.is-selected")).toHaveCount(1);
    const geometry = await selectedMapGeometry(page);
    expect(geometry.markerCenterHit).toBe(true);
    expect(geometry.intersections).toEqual([]);

    await page.getByRole("button", { name: "閉じる" }).click();
    await expect(row).toBeFocused();
    await page.getByRole("button", { name: "地図" }).click();
    await expect(page).toHaveURL(/view=map/);
    await expect(page.locator("main")).toBeVisible();
    await page.getByRole("button", { name: "一覧" }).click();
    await expect(page).toHaveURL(/view=list/);
    await expect(page.locator(".map-place-select").first()).toBeVisible();
  }

  expect(errors).toEqual([]);
});

test("map free-text query keeps the search place set and URL view state", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/map?q=ごみ");
  await expect(page.getByRole("heading", { name: "「ごみ」の施設" })).toBeVisible();
  await expect(page.getByText("0施設を表示しています。地図の位置は目安です。")).toBeVisible();
  await expect(page.locator(".map-place-select")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "地図" })).toBeVisible();
  await expect(page.getByText("なごみ保育園", { exact: true })).toHaveCount(0);
});

test("zero-result search stays empty and does not offer a map CTA", async ({ page }) => {
  await page.goto("/search?q=存在しない情報");
  await expect(page.getByText("見つかりませんでした", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /地図で見る/ })).toHaveCount(0);
});

test("the primary layouts do not overflow at narrow and wide widths", async ({ page }) => {
  for (const width of [320, 360, 390, 430, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(width < 500 ? "/search?q=ごみ" : "/map?category=aed");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const undersizedTargets = await page.locator("main button:visible, main input:visible, main select:visible, main .primary-link:visible, main .section-link:visible, main .map-place-select:visible").evaluateAll((elements) =>
      elements.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width < 44 || rect.height < 44;
      }).map((element) => element.textContent?.trim() || element.getAttribute("aria-label") || element.tagName)
    );
    expect(undersizedTargets).toEqual([]);
  }
});

test("short mobile viewports keep primary controls above the bottom navigation", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  const homeSearch = page.locator(".search-box");
  await expect(homeSearch).toBeVisible();
  await expect.poll(() => controlCenterHit(homeSearch)).not.toBe("bottom-nav");

  const searchInput = page.locator(".search-box input");
  await searchInput.focus();
  await expect(searchInput).toBeFocused();
  await expect.poll(() => page.evaluate(() => {
    const rect = document.querySelector<HTMLInputElement>(".search-box input")?.getBoundingClientRect();
    return Boolean(rect && rect.top >= 0 && rect.bottom <= window.innerHeight);
  })).toBe(true);

  await page.goto("/place/place_childcare_1");
  for (const selector of [".place-detail-actions .primary-link", ".place-detail-actions .action-link"]) {
    const control = page.locator(selector).first();
    await expect(control).toBeVisible();
    await expect.poll(() => controlCenterHit(control)).not.toBe("bottom-nav");
  }
});

test("news date group rows keep category metadata without repeating the group date", async ({ page }) => {
  await page.goto("/news");
  await expect(page.locator(".news-card").first()).toBeVisible();
  const repeatedDates = await page.locator(".news-date-group .news-card .card-kicker").evaluateAll((elements) =>
    elements.filter((element) => /20\d\d[年/-]/.test(element.textContent ?? "")).map((element) => element.textContent)
  );
  expect(repeatedDates).toEqual([]);
});

test("skip link is hidden in normal map state and visible only when focused", async ({ page }) => {
  await page.goto("/map?category=aed");
  await expect(page.locator(".map-place-select").first()).toBeVisible();
  await expect.poll(() => page.locator(".skip-link").evaluate((element) => getComputedStyle(element).transform)).not.toBe("none");
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
});

test("degraded home health is explained near the top of the page", async ({ page }) => {
  const homeFixture = JSON.parse(await readFile(resolve(generatedFixtureDir, "home.json"), "utf8")) as { health: { status: string } };
  homeFixture.health.status = "degraded";
  await page.route("**/generated/home.json", (route) => route.fulfill({ json: homeFixture }));
  await page.goto("/");
  const degradedBanner = page.locator(".data-status--degraded");
  await expect(degradedBanner).toHaveAttribute("role", "status");
  await expect(degradedBanner).toBeVisible();
  await expect(degradedBanner).toContainText("一部の情報を確認できません");
  await expect(degradedBanner).toContainText("郡山市公式サイト");
  expect(await degradedBanner.evaluate((element) => element.tagName)).toBe("DIV");
  await expect(page.locator('aside[role="status"]')).toHaveCount(0);
});

async function routeGeneratedData(page: Page): Promise<void> {
  const files = [
    "build-meta.json",
    "home.json",
    "news.json",
    "places.json",
    "places.geojson",
    "search-index.json"
  ];

  for (const file of files) {
    await page.route(`**/generated/${file}`, (route) =>
      route.fulfill({
        path: resolve(generatedFixtureDir, file),
        contentType: file.endsWith(".geojson") ? "application/geo+json" : "application/json"
      })
    );
  }
}

async function controlCenterHit(locator: ReturnType<Page["locator"]>): Promise<string> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit?.closest(".bottom-nav") ? "bottom-nav" : hit?.closest(".search-box, .place-detail-actions")?.className ?? "other";
  });
}

async function selectedMapGeometry(page: Page) {
  return page.evaluate(() => {
    const marker = document.querySelector<HTMLElement>(".map-pin.is-selected");
    const markerRect = marker?.getBoundingClientRect();
    const obstacles = [
      ["detail", document.querySelector<HTMLElement>(".map-detail-popover .detail-sheet")],
      ["bottom-nav", document.querySelector<HTMLElement>(".bottom-nav")],
      ["notice", document.querySelector<HTMLElement>(".map-stage__notice")],
      ...Array.from(document.querySelectorAll<HTMLElement>(".leaflet-control-zoom, .leaflet-control-attribution")).map((element, index) => [`control-${index}`, element] as const)
    ] as const;
    const intersects = (left: DOMRect, right: DOMRect) => left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
    const intersections = markerRect
      ? obstacles.filter(([, element]) => element && intersects(markerRect, element.getBoundingClientRect())).map(([name]) => name)
      : ["missing-marker"];
    const center = markerRect ? document.elementFromPoint(markerRect.left + markerRect.width / 2, markerRect.top + markerRect.height / 2) : null;
    return {
      selectedCount: document.querySelectorAll(".map-pin.is-selected").length,
      markerCenterHit: Boolean(center?.closest(".map-pin.is-selected")),
      intersections
    };
  });
}

function makeStressMapData() {
  const places = Array.from({ length: 96 }, (_, index) => {
    const id = `stress-place-${index}`;
    const hasIdenticalCoordinate = index % 4 < 3;
    const lat = hasIdenticalCoordinate ? 37.4 : 37.4 + ((index % 12) - 6) * 0.0005;
    const lng = hasIdenticalCoordinate ? 140.36 : 140.36 + (Math.floor(index / 12) - 4) * 0.0005;
    return {
      id,
      name: `Stress marker ${index}`,
      category: "aed",
      categoryLabel: "AED",
      categories: ["aed"],
      address: `Stress block ${index}`,
      lat,
      lng
    };
  });
  const features = places.map((place) => ({
    type: "Feature" as const,
    id: place.id,
    geometry: { type: "Point" as const, coordinates: [place.lng, place.lat] as [number, number] },
    properties: { name: place.name, category: "aed", categories: ["aed"] }
  }));
  return {
    places: { generated_at: "2026-01-01T00:00:00.000Z", count: places.length, places },
    geojson: { type: "FeatureCollection" as const, features },
    searchIndex: {
      generated_at: "2026-01-01T00:00:00.000Z",
      items: places.map((place) => ({
        id: place.id,
        type: "place" as const,
        name: place.name,
        category: place.category,
        categoryLabel: place.categoryLabel,
        categories: place.categories,
        address: place.address,
        keywords: "stress"
      }))
    }
  };
}

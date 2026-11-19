import { describe, expect, it } from "vitest";
import { greetingScenario, scenarioRandom, scenarioSeeds } from "./fixtures/scenarios.js";

describe("seeded scenario sampling", () => {
  it.each(scenarioSeeds)(
    "replays independent requests and varies choices at fixed call strides (seed %i)",
    (seed) => {
      const first = greetingScenario(seed);
      const replay = greetingScenario(seed);
      expect(first).toEqual(replay);
      first.input.name = "changed by this request";
      expect(replay.input.name).not.toBe(first.input.name);
      const random = scenarioRandom(seed);
      const replayRandom = scenarioRandom(seed);
      const booleans = new Set<boolean>();
      const words = new Set<string>();
      for (let index = 0; index < 64; index += 1) {
        random.pick([0, 1]);
        replayRandom.pick([0, 1]);
        const choice = random.pick([false, true]);
        expect(choice).toBe(replayRandom.pick([false, true]));
        booleans.add(choice);
        random.pick([0, 1]);
        replayRandom.pick([0, 1]);
        const word = random.pick(["release", "design", "review", "notes"]);
        expect(word).toBe(replayRandom.pick(["release", "design", "review", "notes"]));
        words.add(word);
      }
      expect(booleans.size).toBe(2);
      expect(words.size).toBe(4);
    },
  );
});

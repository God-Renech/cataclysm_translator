import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backendMain = readFileSync(new URL("../src-tauri/src/main.rs", import.meta.url), "utf8");

test("backend main.rs does not keep common mojibake error fragments", () => {
  const fragments = [
    "鏃犳晥",
    "鍏煎",
    "璇诲彇",
    "鍐欏叆",
    "瑙ｆ瀽",
    "杈撳嚭",
    "涓嶅瓨鍦",
    "澶辫触",
    "鏍￠獙",
    "鐢ㄦ埛",
  ];

  for (const fragment of fragments) {
    assert.equal(
      backendMain.includes(fragment),
      false,
      `unexpected mojibake fragment in main.rs: ${fragment}`,
    );
  }
});

import test from "node:test";
import assert from "node:assert/strict";

import { convertPoContent, getTargetPoLanguageCode } from "../app/renderer/po-convert.js";

test("convertPoContent populates empty msgstr from Chinese msgid", () => {
  const source = [
    'msgid ""',
    'msgstr ""',
    '"Language: zh_CN\\n"',
    '"Plural-Forms: nplurals=1; plural=0;\\n"',
    "",
    'msgid "苹果"',
    'msgstr ""',
    "",
  ].join("\n");

  const converted = convertPoContent(source, getTargetPoLanguageCode("s2t"), (text) =>
    text.replaceAll("苹果", "蘋果")
  );

  assert.match(converted, /msgstr "蘋果"/);
  assert.match(converted, /"Language: zh_TW\\n"/);
});

test("convertPoContent preserves multiline layout when seeding empty msgstr from msgid", () => {
  const source = [
    'msgid ""',
    'msgstr ""',
    '"Language: zh_TW\\n"',
    '"Plural-Forms: nplurals=1; plural=0;\\n"',
    "",
    'msgid ""',
    '"一張貼紙，上面的圖案是一名美少女。\\n"',
    '"⠀⠀⠀⠀⡄⢂⠒⡄⢂⡀\\n"',
    '"⠀⠀⠀⠀⢄⠣⡜⢮⡹⢜⢦⡘⠤"',
    'msgstr ""',
    "",
  ].join("\n");

  const converted = convertPoContent(source, getTargetPoLanguageCode("t2s"), (text) =>
    text
      .replaceAll("一張貼紙，上面的圖案是一名美少女。", "一张贴纸，上面的图案是一名美少女。")
  );

  assert.match(
    converted,
    /msgstr ""\n"一张贴纸，上面的图案是一名美少女。\\n"\n"⠀⠀⠀⠀⡄⢂⠒⡄⢂⡀\\n"\n"⠀⠀⠀⠀⢄⠣⡜⢮⡹⢜⢦⡘⠤"/
  );
  assert.doesNotMatch(converted, /msgstr "一张贴纸，上面的图案是一名美少女。\\n/);
});

test("convertPoContent populates empty plural slot from Chinese plural source", () => {
  const source = [
    'msgid ""',
    'msgstr ""',
    '"Language: zh_CN\\n"',
    '"Plural-Forms: nplurals=1; plural=0;\\n"',
    "",
    'msgid "苹果"',
    'msgid_plural "苹果们"',
    'msgstr[0] ""',
    'msgstr[1] ""',
    "",
  ].join("\n");

  const converted = convertPoContent(source, getTargetPoLanguageCode("s2t"), (text) =>
    text.replaceAll("苹果们", "蘋果們").replaceAll("苹果", "蘋果")
  );

  assert.match(converted, /msgstr\[0\] "蘋果"/);
  assert.match(converted, /msgstr\[1\] "蘋果們"/);
});

test("convertPoContent does not synthesize empty plural variants", () => {
  const source = [
    'msgid ""',
    'msgstr ""',
    '"Language: zh_CN\\n"',
    '"Plural-Forms: nplurals=1; plural=0;\\n"',
    "",
    'msgid "apple"',
    'msgid_plural "apples"',
    'msgstr[0] "苹果"',
    "",
  ].join("\n");

  const converted = convertPoContent(source, getTargetPoLanguageCode("s2t"), (text) =>
    text.replaceAll("苹果", "蘋果")
  );

  assert.match(converted, /msgstr\[0\] "蘋果"/);
  assert.doesNotMatch(converted, /msgstr\[1\]/);
  assert.match(converted, /"Language: zh_TW\\n"/);
});

test("convertPoContent preserves existing meaningful plural variants", () => {
  const source = [
    'msgid ""',
    'msgstr ""',
    '"Language: zh_CN\\n"',
    '"Plural-Forms: nplurals=1; plural=0;\\n"',
    "",
    'msgid "arrow"',
    'msgid_plural "arrows"',
    'msgstr[0] "箭"',
    'msgstr[1] "箭矢束"',
    "",
  ].join("\n");

  const converted = convertPoContent(source, getTargetPoLanguageCode("s2t"), (text) =>
    text.replaceAll("箭矢束", "箭矢束").replaceAll("箭", "箭")
  );

  assert.match(converted, /msgstr\[0\] "箭"/);
  assert.match(converted, /msgstr\[1\] "箭矢束"/);
});

/**
 * Check script for ruby-string-utils benchmark.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ws = process.env.BENCHMARK_WORKSPACE;
if (!ws) throw new Error("BENCHMARK_WORKSPACE env var not set");

test("string_utils.rb was created", () => {
  assert.ok(
    existsSync(join(ws, "string_utils.rb")),
    `string_utils.rb not found. Files: ${readdirSync(ws).join(", ")}`,
  );
});

test("Gemfile was created", () => {
  assert.ok(existsSync(join(ws, "Gemfile")), "Gemfile not found");
});

test("spec/string_utils_spec.rb was created", () => {
  const specDir = join(ws, "spec");
  assert.ok(
    existsSync(join(specDir, "string_utils_spec.rb")),
    `spec/string_utils_spec.rb not found. spec/ contents: ${existsSync(specDir) ? readdirSync(specDir).join(", ") : "(missing)"}`,
  );
});

test("bundle exec rspec passes with examples present", () => {
  const r = spawnSync("bundle", ["exec", "rspec", "spec/", "-f", "documentation"], {
    cwd: ws, encoding: "utf8", timeout: 90_000,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  if (/command not found|No such file/i.test(out)) return; // bundler not installed — skip

  // "0 examples" = no tests ran
  assert.ok(!/\b0 examples\b/i.test(out), `RSpec ran 0 examples — no it-blocks found:\n${out}`);
  assert.ok(r.status === 0, `RSpec failed:\n${out.slice(-2000)}`);
});

test("StringUtils.palindrome? works correctly", () => {
  const r = spawnSync("ruby", ["-e", `
require_relative 'string_utils'
results = [
  [StringUtils.palindrome?('racecar'), true,  'racecar'],
  [StringUtils.palindrome?('hello'),   false, 'hello'],
]
results.each do |got, want, input|
  if got != want
    puts "FAIL: palindrome?(#{input.inspect}) = #{got.inspect}, expected #{want.inspect}"
    exit 1
  end
end
puts 'ok'
`], { cwd: ws, encoding: "utf8", timeout: 10_000 });
  const out = (r.stdout || "") + (r.stderr || "");
  if (/command not found|No such file/i.test(out)) return; // ruby not installed
  assert.strictEqual(r.status, 0, `palindrome? smoke test failed:\n${out}`);
});

test("StringUtils.word_count works correctly", () => {
  const r = spawnSync("ruby", ["-e", `
require_relative 'string_utils'
cases = [['hello world', 2], ['one', 1], ['', 0]]
cases.each do |str, want|
  got = StringUtils.word_count(str)
  if got != want
    puts "FAIL: word_count(#{str.inspect}) = #{got.inspect}, expected #{want}"
    exit 1
  end
end
puts 'ok'
`], { cwd: ws, encoding: "utf8", timeout: 10_000 });
  const out = (r.stdout || "") + (r.stderr || "");
  if (/command not found|No such file/i.test(out)) return;
  assert.strictEqual(r.status, 0, `word_count smoke test failed:\n${out}`);
});

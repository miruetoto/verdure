const { spawnSync } = require("node:child_process");

const tests = [
  "tabs_test.cjs",
  "visual_test.cjs",
  "object_ring_test.cjs",
  "align_test.cjs",
  "code_copy_scroll_test.cjs",
  "interact_test.cjs",
  "insert_test.cjs",
  "sidebar_test.cjs",
  "pdf_view_test.cjs",
  "draw_test.cjs",
];

let failed = 0;
for (const test of tests) {
  process.stdout.write(`\n[chromium] ${test}\n`);
  const result = spawnSync(process.execPath, [test], { stdio: "inherit" });
  if (result.status !== 0) {
    failed++;
    process.stderr.write(`[chromium] FAILED: ${test}\n`);
  }
}
if (failed) {
  process.stderr.write(`\n[chromium] ${failed}/${tests.length} failed\n`);
  process.exit(1);
}
process.stdout.write(`\n[chromium] ${tests.length}/${tests.length} passed\n`);

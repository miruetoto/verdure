const { spawnSync } = require("node:child_process");

const tests = [
  "web_mode_test.cjs",
  "web_save_fallback_test.cjs",
  "autosave_test.cjs",
  "fixed_widget_test.cjs",
  "table_modal_test.cjs",
  "image_modal_test.cjs",
  "callout_test.cjs",
  "tabset_test.cjs",
  "multiroot_test.cjs",
  "web_attach_test.cjs",
  "web_datauri_test.cjs",
  "web_align_test.cjs",
  "web_resize_test.cjs",
  "code_test.cjs",
  "cmd_arrow_test.cjs",
];

let failed = 0;
for (const test of tests) {
  process.stdout.write(`\n[smoke] ${test}\n`);
  const result = spawnSync(process.execPath, [test], { stdio: "inherit" });
  if (result.status !== 0) {
    failed++;
    process.stderr.write(`[smoke] FAILED: ${test}\n`);
  }
}

if (failed) {
  process.stderr.write(`\n[smoke] ${failed}/${tests.length} failed\n`);
  process.exit(1);
}
process.stdout.write(`\n[smoke] ${tests.length}/${tests.length} passed\n`);

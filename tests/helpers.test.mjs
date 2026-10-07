// Unit tests for the helpers that guard redirects, search filters, CSV and HTML output.
// Run with: npm test   (Node's built-in runner; TypeScript is stripped natively)
import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, formatDate, pageCount, parsePage, safeNextPath, sanitizeSearch } from "../src/lib/utils.ts";
import { csvCell, parseRange } from "../src/lib/reports.ts";
import { activityLink, describeActivity } from "../src/lib/activity.ts";

test("safeNextPath only allows same-site relative paths", () => {
  assert.equal(safeNextPath("/tasks"), "/tasks");
  assert.equal(safeNextPath("/tasks?status=pending"), "/tasks?status=pending");
  for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "@evil.com", "javascript:alert(1)", "", null, undefined]) {
    assert.equal(safeNextPath(bad), "/dashboard", String(bad));
  }
  assert.equal(safeNextPath("//evil.com", "/login"), "/login");
});

test("sanitizeSearch strips PostgREST filter syntax and LIKE wildcards", () => {
  assert.equal(sanitizeSearch("alice"), "alice");
  assert.equal(sanitizeSearch(`a%b_c,d(e)f"g'h\\i:j;k*l`), "a b c d e f g h i j k l");
  assert.equal(sanitizeSearch("  too   many   spaces "), "too many spaces");
  assert.equal(sanitizeSearch(null), "");
  assert.equal(sanitizeSearch("x".repeat(500)).length, 80);
});

test("parsePage / pageCount are total and clamp bad input", () => {
  assert.equal(parsePage(undefined), 1);
  assert.equal(parsePage("0"), 1);
  assert.equal(parsePage("-3"), 1);
  assert.equal(parsePage("abc"), 1);
  assert.equal(parsePage("7"), 7);
  assert.equal(parsePage(["4", "9"]), 4);
  assert.equal(parsePage("99999999"), 10000);
  assert.equal(pageCount(0, 10), 1);
  assert.equal(pageCount(null, 10), 1);
  assert.equal(pageCount(21, 10), 3);
});

test("escapeHtml neutralises markup in email bodies", () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
});

test("formatDate treats date-only strings as local dates and tolerates junk", () => {
  assert.equal(formatDate(null), "—");
  assert.equal(formatDate("not a date"), "—");
  assert.match(formatDate("2026-10-06"), /06/);
});

test("csvCell quotes awkward values and defuses spreadsheet formulas", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell('say "hi", ok'), '"say ""hi"", ok"');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(csvCell(null), "");
  assert.equal(csvCell("=HYPERLINK(\"http://x\")"), `"'=HYPERLINK(""http://x"")"`);
  for (const lead of ["=1+1", "+1", "-1", "@SUM(A1)"]) assert.ok(csvCell(lead).startsWith("'"), lead);
});

test("parseRange defaults to 30 days and 'all' has no lower bound", () => {
  assert.equal(parseRange(undefined).key, "30");
  assert.equal(parseRange("nonsense").key, "30");
  assert.equal(parseRange("all").from, null);
  const seven = parseRange("7");
  const days = (Date.now() - new Date(seven.from).getTime()) / 86_400_000;
  assert.ok(days > 6.99 && days < 7.01);
});

test("describeActivity / activityLink read well and link only to things that still exist", () => {
  assert.equal(describeActivity({ action: "task_created", entity_type: "task", entity_id: "t", metadata: { title: "Ship" } }), "created task “Ship”");
  assert.equal(
    describeActivity({ action: "user_role_changed", entity_type: "user", entity_id: "u", metadata: { from: "employee", to: "manager" } }),
    "changed a role from employee to manager"
  );
  assert.equal(describeActivity({ action: "something_new", entity_type: "x", entity_id: null, metadata: null }), "something new");
  assert.equal(activityLink({ action: "task_created", entity_type: "task", entity_id: "abc", metadata: {} }), "/tasks/abc");
  assert.equal(activityLink({ action: "task_deleted", entity_type: "task", entity_id: "abc", metadata: {} }), null);
  assert.equal(activityLink({ action: "employee_updated", entity_type: "employee", entity_id: "e", metadata: {} }), "/employees/e");
});

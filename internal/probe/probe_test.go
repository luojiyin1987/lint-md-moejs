package probe

import "testing"

func TestSimpleModule(t *testing.T) {
    // JavaScript string.length uses UTF-16 code units, not UTF-8 bytes.
    const source = "export function lint(text) { return { complete: true, diagnostics: [{ ruleId: 'test', message: 'ok', severity: 1, line: 1, column: 1, start: 0, end: text.length, fixable: false }] }; }"
    got, err := Run(source, "😀x")
    if err != nil {
        t.Fatal(err)
    }
    if len(got.Diagnostics) != 1 || got.Diagnostics[0].End != 3 {
        t.Fatalf("expected UTF-16 length 3, got: %#v", got)
    }
}

func TestCompileErrorReported(t *testing.T) {
    if _, err := Run("export function lint( {", "hello"); err == nil {
        t.Fatal("invalid JavaScript must produce a compilation error")
    }
}

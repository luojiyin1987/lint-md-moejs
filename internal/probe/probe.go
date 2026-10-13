package probe

import (
    "fmt"

    "github.com/Calcium-Ion/moejs"
)

// Diagnostic is a stable projection of the TypeScript core diagnostic.
// Offsets and columns retain JavaScript UTF-16 semantics.
type Diagnostic struct {
    RuleID   string `json:"ruleId"`
    Message  string `json:"message"`
    Severity int    `json:"severity"`
    Line     int    `json:"line"`
    Column   int    `json:"column"`
    Start    int    `json:"start"`
    End      int    `json:"end"`
    Fixable  bool   `json:"fixable"`
}

type Result struct {
    Complete    bool         `json:"complete"`
    Diagnostics []Diagnostic `json:"diagnostics"`
}

// Run compiles the ESM bundle, loads it into a fresh runtime and invokes
// the exported lint() hook. Each error is annotated with its failure stage.
func Run(moduleSource, markdown string) (Result, error) {
    mod, err := moejs.Compile("lint-md.mjs", moduleSource)
    if err != nil {
        return Result{}, fmt.Errorf("moejs compile: %w", err)
    }
    rt := moejs.NewRuntime(moejs.Options{})
    if err := rt.Load(mod); err != nil {
        return Result{}, fmt.Errorf("moejs load: %w", err)
    }
    hook, err := mod.Hook("lint")
    if err != nil {
        return Result{}, fmt.Errorf("moejs find lint hook: %w", err)
    }
    value, err := rt.Call(hook, moejs.String(markdown))
    if err != nil {
        return Result{}, fmt.Errorf("moejs call lint: %w", err)
    }
    var result Result
    if err := rt.Unmarshal(value, &result); err != nil {
        return Result{}, fmt.Errorf("moejs unmarshal result: %w", err)
    }
    if !result.Complete {
        return Result{}, fmt.Errorf("incomplete lint result")
    }
    return result, nil
}

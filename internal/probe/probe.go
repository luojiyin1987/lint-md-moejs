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

// NotAppliedFix retains the final fix round's coordinates, not the original
// document's positions. A conflict is never silently discarded.
type NotAppliedFix struct {
	Start      int    `json:"start"`
	End        int    `json:"end"`
	Text       string `json:"text"`
	TargetRule string `json:"targetRule"`
	Reason     string `json:"reason"`
}

type FixResult struct {
	Complete             bool            `json:"complete"`
	FixedText            string          `json:"fixedText"`
	Convergence          string          `json:"convergence"`
	Rounds               int             `json:"rounds"`
	InitialDiagnostics   []Diagnostic    `json:"initialDiagnostics"`
	RemainingDiagnostics []Diagnostic    `json:"remainingDiagnostics"`
	NotAppliedFixes      []NotAppliedFix `json:"notAppliedFixes"`
}

func callHook(moduleSource, name string, args ...moejs.Value) (*moejs.Runtime, moejs.Value, error) {
	mod, err := moejs.Compile("lint-md.mjs", moduleSource)
	if err != nil {
		return nil, moejs.Undefined(), fmt.Errorf("moejs compile: %w", err)
	}
	rt := moejs.NewRuntime(moejs.Options{})
	if err := rt.Load(mod); err != nil {
		return nil, moejs.Undefined(), fmt.Errorf("moejs load: %w", err)
	}
	hook, err := mod.Hook(name)
	if err != nil {
		return nil, moejs.Undefined(), fmt.Errorf("moejs find %s hook: %w", name, err)
	}
	value, err := rt.Call(hook, args...)
	if err != nil {
		return nil, moejs.Undefined(), fmt.Errorf("moejs call %s: %w", name, err)
	}
	return rt, value, nil
}

// Run executes the lint-only hook and decodes its deterministic projection.
func Run(moduleSource, markdown string) (Result, error) {
	rt, value, err := callHook(moduleSource, "lint", moejs.String(markdown))
	if err != nil {
		return Result{}, err
	}
	var result Result
	if err := rt.Unmarshal(value, &result); err != nil {
		return Result{}, fmt.Errorf("moejs unmarshal lint result: %w", err)
	}
	if !result.Complete {
		return Result{}, fmt.Errorf("incomplete lint result")
	}
	return result, nil
}

// RunFix executes fixMarkdown through the compiled JS module. Each call
// gets its own runtime; rule state must not leak between documents.
func RunFix(moduleSource, markdown, scenario string) (FixResult, error) {
	rt, value, err := callHook(moduleSource, "fix", moejs.String(markdown), moejs.String(scenario))
	if err != nil {
		return FixResult{}, err
	}
	var result FixResult
	if err := rt.Unmarshal(value, &result); err != nil {
		return FixResult{}, fmt.Errorf("moejs unmarshal fix result: %w", err)
	}
	if !result.Complete {
		return FixResult{}, fmt.Errorf("incomplete fix result")
	}
	if result.Rounds < 1 || (result.Convergence != "stable" && result.Convergence != "cycle" && result.Convergence != "max") {
		return FixResult{}, fmt.Errorf("invalid fix convergence state: %q (%d rounds)", result.Convergence, result.Rounds)
	}
	return result, nil
}

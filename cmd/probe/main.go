package main

import (
    "encoding/json"
    "flag"
    "fmt"
    "io"
    "os"

    "github.com/luojiyin1987/lint-md-moejs/internal/probe"
)

func main() {
    if err := run(); err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
}

func run() error {
    bundlePath := flag.String("bundle", "js/dist/lint-md.mjs", "path to bundled JavaScript ESM")
    flag.Parse()
    if flag.NArg() != 0 {
        return fmt.Errorf("unexpected positional arguments: %v", flag.Args())
    }
    source, err := os.ReadFile(*bundlePath)
    if err != nil {
        return fmt.Errorf("read bundle: %w", err)
    }
    input, err := io.ReadAll(os.Stdin)
    if err != nil {
        return fmt.Errorf("read markdown from stdin: %w", err)
    }
    result, err := probe.Run(string(source), string(input))
    if err != nil {
        return err
    }
    if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
        return fmt.Errorf("encode result: %w", err)
    }
    return nil
}

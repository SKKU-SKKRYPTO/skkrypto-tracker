// Command indexer collects an explicitly versioned Base Sepolia Snapshot or exports its Manifest.
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	os.Exit(defaultApplication(os.Stdout, os.Stderr).run(ctx, os.Args[1:]))
}

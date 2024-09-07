package main

import (
	"context"
	"fmt"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
)

func handler(ctx context.Context, event events.CloudWatchEvent) error {
	fmt.Printf("Received event: %s\n", event.Detail)

	// Log the DynamoDB Stream event
	fmt.Println("Logging DynamoDB stream event...")

	return nil
}

func main() {
	lambda.Start(handler)
}

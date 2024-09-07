package main

import (
	"context"
	"fmt"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
)

func handler(ctx context.Context, event events.CloudWatchEvent) error {
	fmt.Printf("Received event: %s\n", event.Detail)

	// Here you could add logic to send email notifications
	fmt.Println("Sending email notification...")

	return nil
}

func main() {
	lambda.Start(handler)
}

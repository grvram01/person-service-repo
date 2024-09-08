package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/aws/aws-lambda-go/lambda"
)

func handler(ctx context.Context, event map[string]interface{}) error {
	// Print the received event for debugging purposes
	eventJson, err := json.MarshalIndent(event, "", "  ")
	if err != nil {
		log.Printf("Error marshalling event: %v", err)
		return err
	}

	fmt.Printf("Received event: %s\n", string(eventJson))

	// Add logic to send email notifications here
	fmt.Println("Sending email notification...")

	return nil
}

func main() {
	log.Print("email lambda invoked....")
	lambda.Start(handler)
}

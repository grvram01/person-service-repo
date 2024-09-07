package main

import (
	"context"
	"fmt"
	"log"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/eventbridge"
	"github.com/aws/aws-sdk-go/service/eventbridge/eventbridgeiface"
)

type EventBridgeClient struct {
	client eventbridgeiface.EventBridgeAPI
}

func (e *EventBridgeClient) PutEvent(source string, detailType string, detail map[string]interface{}) error {
	event := &eventbridge.PutEventsRequestEntry{
		Source:       aws.String(source),
		DetailType:   aws.String(detailType),
		Detail:       aws.String(fmt.Sprintf("%v", detail)),
		EventBusName: aws.String("DDBStreamCustomEventBus"),
	}

	_, err := e.client.PutEvents(&eventbridge.PutEventsInput{
		Entries: []*eventbridge.PutEventsRequestEntry{event},
	})

	if err != nil {
		log.Printf("Error sending event to EventBridge: %v", err)
		return err
	}
	return nil
}

func handler(ctx context.Context, dynamodbEvent events.DynamoDBEvent) error {
	log.Print("Lambda handler invoked")
	sess := session.Must(session.NewSession())
	ebClient := &EventBridgeClient{
		client: eventbridge.New(sess),
	}

	for _, record := range dynamodbEvent.Records {
		log.Printf("Processing record: %v", record)
		detail := map[string]interface{}{
			"eventID":      record.EventID,
			"eventName":    record.EventName,
			"dynamodbData": record.Change.NewImage, // Customize based on your needs
		}

		err := ebClient.PutEvent("ddb.source", "DynamoDBStreamEvent", detail)
		if err != nil {
			log.Printf("Failed to put event: %v", err)
			return err
		}
	}

	log.Print("Processing complete")
	return nil
}

func main() {
	log.Print("Starting Lambda function")
	lambda.Start(handler)
}

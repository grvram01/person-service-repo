package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"
)

var (
	tableName string
	svc       *dynamodb.Client
)

func init() {
	tableName = os.Getenv("TABLE_NAME") // TableName is set via Lambda environment variable

	// Load AWS configuration
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		log.Fatalf("unable to load SDK config, %v", err)
	}

	// Create DynamoDB client
	svc = dynamodb.NewFromConfig(cfg)
}

// Person represents the data model for a person
type Person struct {
	FirstName   string `json:"firstName"`
	LastName    string `json:"lastName"`
	Address     string `json:"address"`
	PhoneNumber string `json:"phoneNumber"`
}

// ResponseBody defines the structure of the response sent back to the client
type ResponseBody struct {
	PersonID string `json:"personId"`
}

func handlePost(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Parse the request body
	var person Person
	err := json.Unmarshal([]byte(request.Body), &person)
	log.Print("before...")
	if err != nil {
		log.Printf("Failed to parse request body: %v", err)
		return events.APIGatewayProxyResponse{StatusCode: http.StatusBadRequest, Body: "Invalid input"}, nil
	}
	log.Print("successfully ingested request..")

	// Generate a new UUID for the personId
	personID := uuid.New().String()

	// Map the Person struct and generated personId to DynamoDB attribute values
	item := map[string]types.AttributeValue{
		"personId":    &types.AttributeValueMemberS{Value: personID}, // Partition Key
		"firstName":   &types.AttributeValueMemberS{Value: person.FirstName},
		"phoneNumber": &types.AttributeValueMemberS{Value: person.PhoneNumber},
		"lastName":    &types.AttributeValueMemberS{Value: person.LastName},
		"address":     &types.AttributeValueMemberS{Value: person.Address},
	}

	// Put the item into DynamoDB
	_, err = svc.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(tableName),
		Item:      item,
	})
	log.Print("put operation performed....")
	if err != nil {
		log.Printf("Failed to insert item into DynamoDB: %v", err)
		return events.APIGatewayProxyResponse{StatusCode: http.StatusInternalServerError, Body: fmt.Sprintf("Failed to insert item: %v", err)}, nil
	}

	// Prepare the response body
	responseBody := ResponseBody{
		PersonID: personID,
	}

	responseJSON, err := json.Marshal(responseBody)
	if err != nil {
		log.Printf("Failed to marshal response body: %v", err)
		return events.APIGatewayProxyResponse{StatusCode: http.StatusInternalServerError, Body: "Error generating response"}, nil
	}

	// Return success response with the generated personId
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Body:       string(responseJSON),
	}, nil
}

func main() {
	log.Print("ingesting request..")
	lambda.Start(handlePost)
}

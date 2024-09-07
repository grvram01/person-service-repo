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
	if err != nil {
		log.Printf("Failed to parse request body: %v", err)
		return events.APIGatewayProxyResponse{StatusCode: http.StatusBadRequest, Body: "Invalid input for POST"}, nil
	}

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

func handlePut(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	personId := request.PathParameters["personId"]
	if personId == "" {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusBadRequest, Body: "Missing personId"}, nil
	}

	var person Person
	if err := json.Unmarshal([]byte(request.Body), &person); err != nil {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusBadRequest, Body: "Invalid input"}, nil
	}

	updateExpression := "SET firstName = :firstName, phoneNumber = :phoneNumber, lastName = :lastName, address = :address"
	expressionAttributeValues := map[string]types.AttributeValue{
		":firstName":   &types.AttributeValueMemberS{Value: person.FirstName},
		":phoneNumber": &types.AttributeValueMemberS{Value: person.PhoneNumber},
		":lastName":    &types.AttributeValueMemberS{Value: person.LastName},
		":address":     &types.AttributeValueMemberS{Value: person.Address},
	}

	_, err := svc.UpdateItem(context.TODO(), &dynamodb.UpdateItemInput{
		TableName:                 aws.String(tableName),
		Key:                       map[string]types.AttributeValue{"personId": &types.AttributeValueMemberS{Value: personId}},
		UpdateExpression:          aws.String(updateExpression),
		ExpressionAttributeValues: expressionAttributeValues,
	})
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusInternalServerError, Body: err.Error()}, nil
	}

	return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Body: "Item updated successfully"}, nil
}

func handleGet(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Using SCAN for development purpose.
	// GET all call can be optimised using pagination(by reading lastEvaluatedKey flag from ddb)
	// https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html
	personId := request.PathParameters["personId"]

	if personId != "" {
		// Retrieve a single item by personId
		result, err := svc.GetItem(ctx, &dynamodb.GetItemInput{
			TableName: aws.String(tableName),
			Key: map[string]types.AttributeValue{
				"personId": &types.AttributeValueMemberS{Value: personId},
			},
		})
		if err != nil {
			return events.APIGatewayProxyResponse{StatusCode: http.StatusInternalServerError, Body: err.Error()}, nil
		}
		if result.Item == nil {
			return events.APIGatewayProxyResponse{StatusCode: http.StatusNotFound, Body: "Item not found"}, nil
		}

		itemJSON, err := json.Marshal(result.Item)
		if err != nil {
			return events.APIGatewayProxyResponse{StatusCode: http.StatusInternalServerError, Body: err.Error()}, nil
		}

		return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Body: string(itemJSON)}, nil
	}

	// Retrieve all items if personId is not provided
	result, err := svc.Scan(ctx, &dynamodb.ScanInput{
		TableName: aws.String(tableName),
	})
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusInternalServerError, Body: err.Error()}, nil
	}

	itemsJSON, err := json.Marshal(result.Items)
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusInternalServerError, Body: err.Error()}, nil
	}

	return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Body: string(itemsJSON)}, nil
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	switch request.HTTPMethod {
	case "POST":
		return handlePost(ctx, request)
	case "PUT":
		return handlePut(request)
	case "GET":
		return handleGet(ctx, request)
	// add delete person logic here
	default:
		return events.APIGatewayProxyResponse{StatusCode: http.StatusMethodNotAllowed, Body: "Method not allowed"}, nil
	}
}

func main() {
	lambda.Start(handler)
}

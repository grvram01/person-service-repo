package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/dynamodb"
)

var (
	// tableName = os.Getenv("TABLE_NAME")
	tableName = "PersonsDynamoTable"
	svc       *dynamodb.DynamoDB
)

type Person struct {
	FirstName   string `json:"firstName"`
	LastName    string `json:"lastName"`
	PhoneNumber string `json:"phoneNumber"`
	Address     string `json:"address"`
}

func init() {
	sess := session.Must(session.NewSession())
	svc = dynamodb.New(sess)
}

func handler(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	switch request.HTTPMethod {
	case "GET":
		id := request.QueryStringParameters["id"]
		if id == "" {
			return handleGetAll()
		}
		return handleGet(id)
	case "POST":
		return handlePost(request)
	default:
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusMethodNotAllowed,
			Body:       "Method not allowed",
		}, nil
	}
}

func handleGet(personId string) (events.APIGatewayProxyResponse, error) {
	input := &dynamodb.GetItemInput{
		TableName: aws.String(tableName),
		Key: map[string]*dynamodb.AttributeValue{
			"PK": {
				S: aws.String(personId),
			},
		},
	}

	result, err := svc.GetItem(input)
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusInternalServerError, Body: err.Error()}, nil
	}
	if result.Item == nil {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusNotFound, Body: "Item not found"}, nil
	}

	item, err := json.Marshal(result.Item)
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusInternalServerError, Body: err.Error()}, nil
	}

	return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Body: string(item)}, nil
}

func handleGetAll() (events.APIGatewayProxyResponse, error) {
	input := &dynamodb.ScanInput{
		TableName: aws.String(tableName),
	}

	result, err := svc.Scan(input)
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusInternalServerError, Body: err.Error()}, nil
	}

	items, err := json.Marshal(result.Items)
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusInternalServerError, Body: err.Error()}, nil
	}

	return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Body: string(items)}, nil
}

func handlePost(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var item map[string]*dynamodb.AttributeValue
	if err := json.Unmarshal([]byte(request.Body), &item); err != nil {
		log.Print("request body --->")
		log.Print(request.Body)
		return events.APIGatewayProxyResponse{StatusCode: http.StatusBadRequest, Body: "Invalid input"}, nil
	}

	input := &dynamodb.PutItemInput{
		TableName: aws.String(tableName),
		Item:      item,
	}

	_, err := svc.PutItem(input)
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: http.StatusInternalServerError, Body: err.Error()}, nil
	}

	return events.APIGatewayProxyResponse{StatusCode: http.StatusOK, Body: "Item inserted successfully"}, nil
}

func main() {
	log.Print("http lambda invoked...")
	lambda.Start(handler)
}

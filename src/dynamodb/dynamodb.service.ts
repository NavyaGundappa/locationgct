// dynamodb.service.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export const ddbClient = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: "ap-south-1" })
);

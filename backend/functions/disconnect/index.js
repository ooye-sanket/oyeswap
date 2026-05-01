const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, DeleteCommand, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;

  // Find device with this connectionId and mark offline
  const scan = await db.send(new ScanCommand({
    TableName: process.env.DEVICES_TABLE,
    FilterExpression: "connectionId = :cid",
    ExpressionAttributeValues: { ":cid": connectionId }
  }));

  if (scan.Items && scan.Items.length > 0) {
    const device = scan.Items[0];
    await db.send(new UpdateCommand({
      TableName: process.env.DEVICES_TABLE,
      Key: { clientId: device.clientId },
      UpdateExpression: "SET #s = :offline REMOVE connectionId",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":offline": "offline" }
    }));
  }

  // Remove from connections table
  await db.send(new DeleteCommand({
    TableName: process.env.CONNECTIONS_TABLE,
    Key: { connectionId }
  }));

  return { statusCode: 200, body: "Disconnected" };
};
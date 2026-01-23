async store(employeeId: string, dto: LocationDto) {
    await ddbClient.send(
        new PutCommand({
            TableName: "EmployeeLocations",
            Item: {
                PK: employeeId,
                SK: dto.trackedAt,
                latitude: dto.latitude,
                longitude: dto.longitude,
            },
        })
    );
    return { success: true };
}

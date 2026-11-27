# Minimal API example

Public, read-only example. Add appropriate authentication/authorization before using it for private resources.

## Features/Tasks/TaskDtos.cs

```csharp
namespace Api.Features.Tasks;
public sealed record TaskDto(Guid Id, string Title);
public sealed record TaskItem(Guid Id, string Title);
```

## Features/Tasks/ITaskReader.cs

```csharp
namespace Api.Features.Tasks;
public interface ITaskReader
{
    Task<TaskItem?> FindAsync(Guid id, CancellationToken cancellationToken);
}
```

## Features/Tasks/GetTask.cs

```csharp
namespace Api.Features.Tasks;
public static class GetTask
{
    public static Task<TaskItem?> ExecuteAsync(Guid id, ITaskReader reader, CancellationToken ct)
        => reader.FindAsync(id, ct);
}
```

## Features/Tasks/GetTaskEndpoint.cs

```csharp
namespace Api.Features.Tasks;
public static class GetTaskEndpoint
{
    public static void Map(IEndpointRouteBuilder routes)
    {
        routes.MapGet("/api/v1/tasks/{id}", HandleAsync);
    }

    private static async Task<IResult> HandleAsync(
        string id, ITaskReader reader, CancellationToken ct)
    {
        if (!Guid.TryParse(id, out var key))
            return Results.Problem(statusCode: 400, title: "Invalid task id");

        var task = await GetTask.ExecuteAsync(key, reader, ct);
        return task is null
            ? Results.Problem(statusCode: 404, title: "Task not found")
            : Results.Ok(new TaskDto(task.Id, task.Title));
    }
}
```

## Program.cs (minimal example with demo implementation)

```csharp
using Api.Features.Tasks;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddProblemDetails();
builder.Services.AddHealthChecks();
builder.Services.AddSingleton<ITaskReader, DemoTaskReader>();

var app = builder.Build();
app.UseExceptionHandler();
app.UseStatusCodePages();
app.MapHealthChecks("/health/live");
GetTaskEndpoint.Map(app);
app.Run();

public partial class Program { }

public sealed class DemoTaskReader : ITaskReader
{
    public Task<TaskItem?> FindAsync(Guid id, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult<TaskItem?>(null);
    }
}
```

Replace DemoTaskReader with a real implementation in production; add readiness and appropriate authentication. Keep explicit registration in Program.cs. In integration tests use WebApplicationFactory<Program> and ConfigureTestServices to replace ITaskReader with a deterministic fake. Verify invalid ID is 400, unknown ID is 404 and existing ID produces only the public TaskDto fields.

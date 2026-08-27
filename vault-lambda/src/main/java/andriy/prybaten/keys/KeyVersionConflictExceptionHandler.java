package andriy.prybaten.keys;

import io.micronaut.context.annotation.Requires;
import io.micronaut.http.HttpRequest;
import io.micronaut.http.HttpResponse;
import io.micronaut.http.annotation.Produces;
import io.micronaut.http.server.exceptions.ExceptionHandler;
import jakarta.inject.Singleton;

import java.util.Map;

/** Maps {@link KeyVersionConflictException} to 409 Conflict. */
@Produces
@Singleton
@Requires(classes = KeyVersionConflictException.class)
public class KeyVersionConflictExceptionHandler
        implements ExceptionHandler<KeyVersionConflictException, HttpResponse<?>> {

    @Override
    public HttpResponse<?> handle(HttpRequest request, KeyVersionConflictException exception) {
        return HttpResponse.status(io.micronaut.http.HttpStatus.CONFLICT)
                .body(Map.of("message", exception.getMessage()));
    }
}

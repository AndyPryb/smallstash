package andriy.prybaten.error;

/** Base type for "the authenticated user doesn't have this resource yet" - mapped to HTTP 404 by {@link ResourceNotFoundExceptionHandler}. */
public class ResourceNotFoundException extends RuntimeException {

    public ResourceNotFoundException(String message) {
        super(message);
    }
}

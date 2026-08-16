package andriy.prybaten.keys;

import io.micronaut.serde.annotation.Serdeable;

import java.time.Instant;

@Serdeable
public record UserProfile(Instant createdAt, String plan, long storageBytesUsed) {
}

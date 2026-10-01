#   docker build -t deutsch-vocab-trainer .
#   docker run -p 8080:8080 deutsch-vocab-trainer
FROM eclipse-temurin:21-jdk AS build
WORKDIR /src
COPY . .
RUN sh ./mvnw -q -B -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/vocab-backend-*.jar app.jar
# Cloud Run / Render / Railway pass the port in $PORT (application.properties reads it).
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]

# Build stage
FROM golang:alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /gateway ./cmd/gateway/

# Frontend build stage
FROM node:20-alpine AS frontend-builder
WORKDIR /app
# We copy the entire web directory to maintain context
COPY web ./web
WORKDIR /app/web/dashboard
RUN npm install
RUN npm run build

# Runtime stage
FROM alpine:3.19

RUN apk --no-cache add ca-certificates && \
    addgroup -S gateway && adduser -S gateway -G gateway

COPY --from=builder /gateway /gateway
COPY configs/gateway.yaml /configs/gateway.yaml
COPY --from=frontend-builder /app/web/dashboard/dist /web/dashboard/dist

USER gateway

EXPOSE 8080 9091

ENTRYPOINT ["/gateway"]
CMD ["-config", "/configs/gateway.yaml"]

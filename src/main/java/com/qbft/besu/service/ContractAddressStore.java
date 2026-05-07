package com.qbft.besu.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

@Component
public class ContractAddressStore {
    private final String filePath;

    public ContractAddressStore(@Value("${besu.contract.file}") String filePath) {
        this.filePath = filePath;
    }

    public void save(String address) {
        try {
            Files.writeString(Path.of(filePath), address);
        } catch (IOException e) {
            throw new RuntimeException("Failed to save contract address", e);
        }
    }

    public Optional<String> load() {
        try {
            Path path = Path.of(filePath);
            if (!Files.exists(path)) {
                return Optional.empty();
            }
            String address = Files.readString(path).trim();
            return address.isEmpty() ? Optional.empty() : Optional.of(address);
        } catch (IOException e) {
            throw new RuntimeException("Failed to load contract address", e);
        }
    }

    public void clear() {
        try {
            Files.deleteIfExists(Path.of(filePath));
        } catch (IOException e) {
            throw new RuntimeException("Failed to clear contract address", e);
        }
    }
}

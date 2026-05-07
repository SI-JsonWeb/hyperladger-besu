package com.qbft.besu.controller;

import com.qbft.besu.service.PrivateTokenService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.Arrays;

@RestController
@RequestMapping("/private-token")
@RequiredArgsConstructor
public class PrivateTokenController {

    private final PrivateTokenService privateTokenService;

    @PostMapping("/deploy")
    public String deploy() throws Exception {
        return privateTokenService.deployPrivateToken();
    }

    @PostMapping("/transfer")
    public String transfer(@RequestParam String to, @RequestParam long amount) throws Exception {
        return privateTokenService.privateTransfer(to, amount);
    }

    @GetMapping("/balance/{address}")
    public String balance(@PathVariable String address) throws Exception {
        return privateTokenService.privateBalance(address);
    }
}

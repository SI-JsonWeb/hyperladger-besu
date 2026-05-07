package com.qbft.besu.controller;

import com.qbft.besu.service.TokenService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/token")
@RequiredArgsConstructor
public class TokenController {

    private final TokenService tokenService;

    @PostMapping("/deploy")
    public String deploy() throws Exception {
        return tokenService.deployToken();
    }

    @GetMapping("/name")
    public String name() throws Exception {
        return tokenService.getTokenName();
    }

    @GetMapping("/total-supply")
    public String totalSupply() throws Exception {
        return tokenService.getTotalSupply();
    }

    @GetMapping("/balance/{address}")
    public String balance(@PathVariable String address) throws Exception {
        return tokenService.getBalance(address);
    }

    @PostMapping("/transfer")
    public String transfer(@RequestParam String to, @RequestParam long amount) throws Exception {
        return tokenService.transfer(to, amount);
    }

    @PostMapping("/approve")
    public String approve(@RequestParam String spender, @RequestParam long amount) throws Exception {
        return tokenService.approve(spender, amount);
    }

    @PostMapping("/redeploy")
    public String redeploy() throws Exception {
        return tokenService.redeployToken();
    }

    @GetMapping("/address")
    public String address() {
        return tokenService.getContractAddress();
    }
}
